const { AsyncLocalStorage } = require("node:async_hooks")
const diagnostics = require("node:diagnostics_channel")
const { performance } = require("node:perf_hooks")
const { setTimeout, clearTimeout } = require("node:timers")
const { setTimeout: sleep } = require("node:timers/promises")

const MAX_DELAY_MS = 30_000
const MAX_TOTAL_DELAY_MS = 40_000
const PERMANENT_CODES = new Set([
    "INVALID_ARGUMENT", "FAILED_PRECONDITION", "UNAUTHENTICATED", "PERMISSION_DENIED", "NOT_FOUND",
    "API_KEY_INVALID", "API_KEY_SERVICE_BLOCKED", "API_KEY_HTTP_REFERRER_BLOCKED", "API_KEY_IP_ADDRESS_BLOCKED",
    "API_KEY_ANDROID_APP_BLOCKED", "API_KEY_IOS_APP_BLOCKED", "ACCESS_TOKEN_EXPIRED", "ACCESS_TOKEN_INVALID",
    "CONSUMER_INVALID", "CONSUMER_SUSPENDED", "USER_PROJECT_DENIED"
])
const transportContext = new AsyncLocalStorage()
let requests = new WeakMap()
let activeOperations = 0

// SDK 1.42 drops error headers. Observe Node fetch's documented channels, without patching fetch or the SDK.
function onRequest({ request }) {
    const context = transportContext.getStore()
    if (context) requests.set(request, context)
}
function onHeaders({ request, response }) {
    const context = requests.get(request)
    if (!context) return
    requests.delete(request)
    if (response.statusCode !== 429 && response.statusCode !== 503) return
    const retryAfter = headerValue(response.headers)
    if (typeof retryAfter === "string") {
        context.retryAfter = retryAfter
        context.receivedAt = performance.now()
        context.status = response.statusCode
    }
}

function retainTransportObservers() {
    if (activeOperations++ === 0) {
        diagnostics.subscribe("undici:request:create", onRequest)
        diagnostics.subscribe("undici:request:headers", onHeaders)
    }
}

function releaseTransportObservers() {
    if (--activeOperations === 0) {
        diagnostics.unsubscribe("undici:request:create", onRequest)
        diagnostics.unsubscribe("undici:request:headers", onHeaders)
        requests = new WeakMap()
    }
}

function extractProviderError(error) {
    const directError = error?.response?.data?.error || error?.error
    if (directError && typeof directError === "object") return directError
    if (typeof error?.message !== "string") return undefined
    const jsonStart = error.message.indexOf("{")
    if (jsonStart < 0) return undefined
    try { return JSON.parse(error.message.slice(jsonStart))?.error } catch { return undefined }
}

function headerValue(headers) {
    if (Array.isArray(headers)) {
        for (let index = 0; index < headers.length; index += 2) {
            if (String(headers[index]).toLowerCase() === "retry-after") return String(headers[index + 1])
        }
        return undefined
    }
    if (typeof headers?.get === "function") return headers.get("retry-after")
    if (!headers || typeof headers !== "object") return undefined
    return Object.entries(headers).find(([name]) => name.toLowerCase() === "retry-after")?.[1]
}

function retryMinimum(error, transport) {
    const provider = extractProviderError(error)
    const status = [error?.status, error?.statusCode, error?.response?.status, provider?.code].find(Number.isInteger)
    const code = provider?.status || error?.code
    if (![429, 503].includes(status) && !(status === undefined && code === "UNAVAILABLE")) return undefined
    const details = Array.isArray(provider?.details) ? provider.details : []
    const quotaFailures = details.filter(detail => detail?.["@type"] === "type.googleapis.com/google.rpc.QuotaFailure")
    const permanent = /daily|per[ _-]?day|per[ _-]?month|billing|payment|prepay|credits?|spend[ _-]?(?:cap|limit)|(?:service|api).{0,24}disabled/i
    const reasons = details.filter(detail => detail?.["@type"] === "type.googleapis.com/google.rpc.ErrorInfo")
    if ([provider?.status, error?.code, ...reasons.map(detail => detail.reason)].some(reason => PERMANENT_CODES.has(reason))) return undefined
    if (permanent.test(`${code || ""} ${provider?.message || ""} ${reasons.map(detail => detail.reason).join(" ")} ${JSON.stringify(quotaFailures)}`)) return undefined
    for (const failure of quotaFailures) {
        if (!Array.isArray(failure.violations) || !failure.violations.length) return undefined
        if (failure.violations.some(violation => Number(violation?.quotaValue) === 0 ||
            !/per[ _-]?(?:minute|second)|\b(?:RPM|TPM|RPS|TPS)\b/i.test(`${violation?.quotaId} ${violation?.quotaMetric} ${violation?.description}`))) return undefined
    }
    if (reasons.some(detail => /quota/i.test(detail.reason || "")) && !quotaFailures.length) return undefined

    const minimums = []
    for (const info of details.filter(detail => detail?.["@type"] === "type.googleapis.com/google.rpc.RetryInfo")) {
        if (typeof info.retryDelay !== "string" || !/^\d+(?:\.\d{1,9})?s$/.test(info.retryDelay)) return undefined
        const delay = Number(info.retryDelay.slice(0, -1)) * 1000
        if (!Number.isFinite(delay)) return undefined
        minimums.push(delay)
    }
    const observedHeader = transport.status === status ? transport.retryAfter : undefined
    const retryAfter = observedHeader ?? headerValue(error?.response?.headers) ?? headerValue(error?.headers)
    if (retryAfter !== undefined && retryAfter !== null) {
        if (typeof retryAfter !== "string") return undefined
        const value = retryAfter.trim()
        const httpDate = /^(?:(?:[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4}|[A-Za-z]+, \d{2}-[A-Za-z]{3}-\d{2}) \d{2}:\d{2}:\d{2} GMT|[A-Za-z]{3} [A-Za-z]{3} [ \d]\d \d{2}:\d{2}:\d{2} \d{4})$/
        if (!/^\d+$/.test(value) && !httpDate.test(value)) return undefined
        const delay = /^\d+$/.test(value)
            ? Number(value) * 1000 - (observedHeader === undefined ? 0 : performance.now() - transport.receivedAt)
            : Date.parse(value) - Date.now()
        if (!Number.isFinite(delay)) return undefined
        minimums.push(Math.max(0, delay))
    }
    if (status === 429 && !minimums.length) return undefined
    return Math.max(0, ...minimums)
}

function operationError(cancelled) {
    return Object.assign(new Error(cancelled ? "Resume PDF Gemini operation cancelled" : "Resume PDF Gemini deadline exceeded"), {
        name: cancelled ? "AbortError" : "TimeoutError",
        status: cancelled ? 499 : 504,
        code: cancelled ? "CANCELLED" : "DEADLINE_EXCEEDED"
    })
}

async function generateResumePdfContent(ai, request, { signal, timeoutMs } = {}) {
    const configured = timeoutMs ?? process.env.RESUME_PDF_GEMINI_TIMEOUT_MS ?? 60_000
    const duration = typeof configured === "string" && /^\d+$/.test(configured) ? Number(configured) : configured
    if (!Number.isInteger(duration) || duration < 1 || duration > 120_000) throw new Error("Invalid RESUME_PDF_GEMINI_TIMEOUT_MS: expected 1 to 120000 milliseconds")
    const controller = new AbortController()
    const cancel = () => controller.abort(operationError(true))
    const deadline = performance.now() + duration
    const timer = setTimeout(() => controller.abort(operationError(false)), duration)
    let onAbort
    const aborted = new Promise((resolve, reject) => {
        onAbort = () => reject(controller.signal.reason)
        controller.signal.addEventListener("abort", onAbort, { once: true })
    })
    signal?.addEventListener("abort", cancel, { once: true })
    // The shared rejection is handled even when a pre-aborted caller prevents the first race.
    aborted.catch(() => {})
    if (signal?.aborted) cancel()
    let attemptCount = 0
    let previousBase = 0
    let totalDelay = 0
    const checkDeadline = () => {
        if (performance.now() >= deadline && !controller.signal.aborted) controller.abort(operationError(false))
        controller.signal.throwIfAborted()
    }
    retainTransportObservers()
    try {
        while (true) {
            checkDeadline()
            const transport = {}
            attemptCount += 1
            try {
                const response = await transportContext.run(transport, () => Promise.race([
                    ai.models.generateContent({
                        ...request,
                        config: {
                            ...request.config,
                            httpOptions: { ...request.config?.httpOptions, timeout: Math.max(1, Math.ceil(deadline - performance.now())) },
                            abortSignal: controller.signal
                        }
                    }),
                    aborted
                ]))
                checkDeadline()
                return response
            } catch (error) {
                checkDeadline()
                const minimum = attemptCount < 3 ? retryMinimum(error, transport) : undefined
                if (minimum === undefined) throw error
                const base = Math.max(minimum, previousBase ? previousBase * 2 : 1000)
                if (base > MAX_DELAY_MS) throw error
                const delay = Math.min(MAX_DELAY_MS, base + Math.floor(Math.random() * 251))
                if (totalDelay + delay > MAX_TOTAL_DELAY_MS || delay >= deadline - performance.now()) throw error
                previousBase = base
                totalDelay += delay
                await Promise.race([sleep(delay, undefined, { signal: controller.signal }), aborted])
            }
        }
    } catch (error) {
        const failure = controller.signal.aborted ? controller.signal.reason : error
        if (failure && typeof failure === "object") failure.attemptCount = attemptCount
        throw failure
    } finally {
        releaseTransportObservers()
        clearTimeout(timer)
        signal?.removeEventListener("abort", cancel)
        controller.signal.removeEventListener("abort", onAbort)
    }
}

module.exports = { generateResumePdfContent, extractProviderError }

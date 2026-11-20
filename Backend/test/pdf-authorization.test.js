const { test, beforeEach, afterEach, after } = require("node:test")
const assert = require("node:assert/strict")
const jwt = require("jsonwebtoken")
const request = require("supertest")
const { EventEmitter } = require("node:events")

const TEST_JWT_SECRET = "pdf-authorization-test-secret"
const OWNER_ID = "owner-user-id"
const OTHER_USER_ID = "other-user-id"
const OWNER_REPORT_ID = "owner-report-id"
const OTHER_REPORT_ID = "other-report-id"

process.env.JWT_SECRET = TEST_JWT_SECRET
process.env.GOOGLE_GENAI_API_KEY = "pdf-authorization-test-key"

const interviewReportModel = require("../src/models/interviewReport.model")
const tokenBlacklistModel = require("../src/models/blacklist.model")
const aiService = require("../src/services/ai.service")

const originalReportFindOne = interviewReportModel.findOne
const originalBlacklistFindOne = tokenBlacklistModel.findOne
const originalGenerateResumePdf = aiService.generateResumePdf
let capturedResumeGenerationArgs
let resumeGenerationImplementation

aiService.generateResumePdf = async (args) => {
    capturedResumeGenerationArgs = args
    return resumeGenerationImplementation(args)
}

const app = require("../src/app")
const { generateResumePdfController } = require("../src/controllers/interview.controller")

function tokenFor(userId) {
    return jwt.sign({ id: userId, username: userId }, TEST_JWT_SECRET)
}

function authenticatedRequest(userId, reportId) {
    return request(app)
        .post(`/api/interview/resume/pdf/${reportId}`)
        .set("Cookie", [`token=${tokenFor(userId)}`])
        .set("X-Expected-User-Id", userId)
        .set("Origin", "http://localhost:5173")
}

beforeEach(() => {
    capturedResumeGenerationArgs = undefined
    resumeGenerationImplementation = async () => Buffer.from("%PDF-test-content")
    tokenBlacklistModel.findOne = async () => null

    interviewReportModel.findOne = async (query) => {
        if (query._id === OWNER_REPORT_ID && query.user === OWNER_ID) {
            return {
                resume: "owner resume",
                jobDescription: "owner job",
                selfDescription: "owner profile",
                analysisVersion: "2.0",
                confirmedSkills: [{ normalizedName: "Docker", originalText: "Docker", sourceType: "userConfirmed", confidence: "userConfirmed" }],
                requirementAnalysis: { requirements: [{ normalizedName: "Docker", status: "matched" }] },
                strengths: ["Evidence-backed strength"],
                areasOfImprovement: ["Evidence-backed improvement"],
                resumeGaps: [],
                skillGaps: [],
                experienceAlignment: "Experience context",
                educationCertificationAnalysis: "Education context"
            }
        }

        if (query._id === OTHER_REPORT_ID && query.user === OTHER_USER_ID) {
            return {
                resume: "other resume",
                jobDescription: "other job",
                selfDescription: "other profile"
            }
        }

        return null
    }
})

afterEach(() => {
    interviewReportModel.findOne = originalReportFindOne
    tokenBlacklistModel.findOne = originalBlacklistFindOne
})

after(() => {
    aiService.generateResumePdf = originalGenerateResumePdf
    delete require.cache[require.resolve("../src/app")]
    delete require.cache[require.resolve("../src/models/interviewReport.model")]
    delete require.cache[require.resolve("../src/models/blacklist.model")]
    delete require.cache[require.resolve("../src/services/ai.service")]
})

test("authenticated owner receives their report PDF", async () => {
    const response = await authenticatedRequest(OWNER_ID, OWNER_REPORT_ID).set("X-Request-Id", "request-123")

    assert.equal(response.status, 200)
    assert.equal(response.headers["content-type"], "application/pdf")
    assert.equal(response.body.toString(), "%PDF-test-content")
    assert.equal(capturedResumeGenerationArgs.requestId, "request-123")
})

test("authenticated owner generation uses the latest persisted V2 context", async () => {
    const response = await authenticatedRequest(OWNER_ID, OWNER_REPORT_ID)

    assert.equal(response.status, 200)
    assert.equal(capturedResumeGenerationArgs.analysisContext.analysisVersion, "2.0")
    assert.deepEqual(capturedResumeGenerationArgs.analysisContext.confirmedSkills.map(skill => skill.normalizedName), ["Docker"])
    assert.equal(capturedResumeGenerationArgs.analysisContext.requirementAnalysis.requirements[0].normalizedName, "Docker")
    assert.deepEqual(capturedResumeGenerationArgs.analysisContext.strengths, ["Evidence-backed strength"])
})

test("authenticated non-owner receives 404 for another user's report", async () => {
    const response = await authenticatedRequest(OWNER_ID, OTHER_REPORT_ID)

    assert.equal(response.status, 404)
    assert.deepEqual(response.body, { message: "Interview report not found." })
})

test("authenticated user receives 404 for a nonexistent report", async () => {
    const response = await authenticatedRequest(OWNER_ID, "missing-report-id")

    assert.equal(response.status, 404)
    assert.deepEqual(response.body, { message: "Interview report not found." })
})

test("unauthenticated user receives 401", async () => {
    const response = await request(app)
        .post(`/api/interview/resume/pdf/${OWNER_REPORT_ID}`)

    assert.equal(response.status, 401)
    assert.deepEqual(response.body, { message: "Token not provided." })
})

function controllerRequestResponse() {
    const req = Object.assign(new EventEmitter(), {
        params: { interviewReportId: OWNER_REPORT_ID },
        user: { id: OWNER_ID },
        aborted: false
    })
    const res = Object.assign(new EventEmitter(), {
        writableEnded: false,
        destroyed: false,
        status(code) { this.statusCode = code; return this },
        set(headers) { this.headers = headers; return this },
        json(body) { this.body = body; this.writableEnded = true; return this },
        send(body) {
            this.body = body
            this.writableEnded = true
            this.emit("close")
            return this
        }
    })
    return { req, res }
}

function deferred() {
    let resolve
    let reject
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return { promise, resolve, reject }
}

test("PDF controller forwards a live signal and does not abort a completed response", async () => {
    const { req, res } = controllerRequestResponse()
    await generateResumePdfController(req, res)
    assert.ok(capturedResumeGenerationArgs.signal instanceof AbortSignal)
    assert.equal(capturedResumeGenerationArgs.signal.aborted, false)
    assert.equal(res.body.toString(), "%PDF-test-content")
    assert.equal(res.headers["Content-Type"], "application/pdf")
    assert.equal(req.listenerCount("aborted"), 0)
    assert.equal(res.listenerCount("close"), 0)
})

for (const disconnectEvent of ["aborted", "close"]) {
    test(`PDF controller cancels generation on ${disconnectEvent} and sends no response`, async () => {
        const { req, res } = controllerRequestResponse()
        const started = deferred()
        const generation = deferred()
        resumeGenerationImplementation = () => { started.resolve(); return generation.promise }
        const operation = generateResumePdfController(req, res)
        await started.promise
        if (disconnectEvent === "aborted") req.emit("aborted")
        else res.emit("close")
        generation.resolve(Buffer.from("%PDF-cancelled-result"))
        await operation
        assert.equal(capturedResumeGenerationArgs.signal?.aborted, true)
        assert.equal(res.body, undefined)
        assert.equal(res.headers, undefined)
        assert.equal(req.listenerCount("aborted"), 0)
        assert.equal(res.listenerCount("close"), 0)
    })
}

test("PDF controller suppresses abort failure after disconnect and cleans up listeners", async () => {
    const { req, res } = controllerRequestResponse()
    const started = deferred()
    const generation = deferred()
    resumeGenerationImplementation = () => { started.resolve(); return generation.promise }
    const operation = generateResumePdfController(req, res)
    await started.promise
    res.emit("close")
    generation.reject(new DOMException("The operation was aborted", "AbortError"))
    await operation
    assert.equal(res.body, undefined)
    assert.equal(req.listenerCount("aborted"), 0)
    assert.equal(res.listenerCount("close"), 0)
})

test("PDF controller does not begin generation if the client disconnects during its single lookup", async () => {
    const { req, res } = controllerRequestResponse()
    const lookup = deferred()
    let lookupCount = 0
    interviewReportModel.findOne = () => { lookupCount++; return lookup.promise }
    const operation = generateResumePdfController(req, res)
    res.emit("close")
    lookup.resolve({ resume: "owner resume", jobDescription: "owner job" })
    await operation
    assert.equal(lookupCount, 1)
    assert.equal(capturedResumeGenerationArgs, undefined)
    assert.equal(res.body, undefined)
    assert.equal(req.listenerCount("aborted"), 0)
    assert.equal(res.listenerCount("close"), 0)
})

for (const closedState of ["aborted", "destroyed"]) {
    test(`PDF controller does not begin work for an initially ${closedState} client`, async () => {
        const { req, res } = controllerRequestResponse()
        if (closedState === "aborted") req.aborted = true
        else res.destroyed = true
        let lookupCount = 0
        interviewReportModel.findOne = async () => { lookupCount++; return null }
        await generateResumePdfController(req, res)
        assert.equal(lookupCount, 0)
        assert.equal(capturedResumeGenerationArgs, undefined)
        assert.equal(res.body, undefined)
        assert.equal(req.listenerCount("aborted"), 0)
        assert.equal(res.listenerCount("close"), 0)
    })
}

test("PDF controller preserves provider failures for a connected client and cleans up listeners", async () => {
    const { req, res } = controllerRequestResponse()
    const failure = Object.assign(new Error("Provider unavailable"), { upstreamStatus: 503 })
    resumeGenerationImplementation = async () => { throw failure }
    await assert.rejects(generateResumePdfController(req, res), error => error === failure)
    assert.equal(res.body, undefined)
    assert.equal(capturedResumeGenerationArgs.signal?.aborted, false)
    assert.equal(req.listenerCount("aborted"), 0)
    assert.equal(res.listenerCount("close"), 0)
})

test("PDF controller removes disconnect listeners when lookup fails", async () => {
    const { req, res } = controllerRequestResponse()
    const failure = new Error("Database unavailable")
    interviewReportModel.findOne = async () => { throw failure }
    await assert.rejects(generateResumePdfController(req, res), error => error === failure)
    assert.equal(capturedResumeGenerationArgs, undefined)
    assert.equal(req.listenerCount("aborted"), 0)
    assert.equal(res.listenerCount("close"), 0)
})

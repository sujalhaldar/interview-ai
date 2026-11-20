const { test, beforeEach, afterEach, after } = require("node:test")
const assert = require("node:assert/strict")
const jwt = require("jsonwebtoken")
const request = require("supertest")

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

aiService.generateResumePdf = async (args) => { capturedResumeGenerationArgs = args; return Buffer.from("%PDF-test-content") }

const app = require("../src/app")

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

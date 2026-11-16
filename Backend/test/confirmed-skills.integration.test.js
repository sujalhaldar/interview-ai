const { test, beforeEach, afterEach, after } = require("node:test")
const assert = require("node:assert/strict")
const jwt = require("jsonwebtoken")
const request = require("supertest")

const TEST_SECRET = "confirmed-skills-test-secret"
const USER_ID = "confirmed-skills-user"
process.env.JWT_SECRET = TEST_SECRET
process.env.GOOGLE_GENAI_API_KEY = "confirmed-skills-test-key"

const app = require("../src/app")
const interviewReportModel = require("../src/models/interviewReport.model")
const tokenBlacklistModel = require("../src/models/blacklist.model")
const aiService = require("../src/services/ai.service")
const originalFindOne = interviewReportModel.findOne
const originalFindOneAndUpdate = interviewReportModel.findOneAndUpdate
const originalBlacklistFindOne = tokenBlacklistModel.findOne
const originalGenerateQualitative = aiService.generateQualitativeResumeAnalysis
const originalGeneratePdf = aiService.generateResumePdf

const report = { _id: "report-id", user: USER_ID, jobDescription: "Required: Docker", resume: "Skills\nDocker", selfDescription: "Developer", overallSummary: "Original summary", strengths: ["Original strength"], areasOfImprovement: ["Original improvement"], technicalQuestions: [{ question: "Keep me", intention: "Keep", answer: "Keep" }], confirmedSkills: [], analysisRevision: 0 }

function cookie(userId = USER_ID) {
    return "token=" + jwt.sign({ id: userId }, TEST_SECRET)
}
function auth(requestBuilder, userId = USER_ID) {
    return requestBuilder.set("Cookie", [cookie(userId)]).set("X-Expected-User-Id", userId)
}

beforeEach(() => {
    tokenBlacklistModel.findOne = async () => null
    interviewReportModel.findOne = async () => ({ ...report })
    interviewReportModel.findOneAndUpdate = async (query, update) => ({ ...report, ...update.$set })
})

afterEach(() => {
    interviewReportModel.findOne = originalFindOne
    interviewReportModel.findOneAndUpdate = originalFindOneAndUpdate
    tokenBlacklistModel.findOne = originalBlacklistFindOne
    aiService.generateQualitativeResumeAnalysis = originalGenerateQualitative
    aiService.generateResumePdf = originalGeneratePdf
})

after(() => { delete require.cache[require.resolve("../src/app")] })

test("saves normalized confirmed skills and recalculates without Gemini or PDF generation", async () => {
    let update
    let geminiCalls = 0
    let pdfCalls = 0
    aiService.generateQualitativeResumeAnalysis = async () => { geminiCalls += 1 }
    aiService.generateResumePdf = async () => { pdfCalls += 1 }
    interviewReportModel.findOneAndUpdate = async (query, value) => { update = value; return { ...report, ...value.$set } }

    const response = await auth(request(app).patch("/api/interview/report/report-id/confirmed-skills")).send({ skills: ["JS", "Docker", "Docker"] })
    assert.equal(response.status, 200)
    assert.deepEqual(update.$set.confirmedSkills.map(skill => skill.normalizedName), ["JavaScript", "Docker"])
    assert.equal(update.$set.analysisRevision, 1)
    assert.equal(update.$set.resume, undefined)
    assert.equal(update.$set.technicalQuestions, undefined)
    assert.equal(update.$set.requirementAnalysis.requirements[0].status, "matched")
    assert.ok(update.$set.categoryScores)
    assert.equal(geminiCalls, 0)
    assert.equal(pdfCalls, 0)
})

test("requires authentication and validates the ownership query", async () => {
    const unauthenticated = await request(app).patch("/api/interview/report/report-id/confirmed-skills").send({ skills: ["Docker"] })
    assert.equal(unauthenticated.status, 401)
    let query
    interviewReportModel.findOne = async value => { query = value; return null }
    const response = await auth(request(app).patch("/api/interview/report/report-id/confirmed-skills")).send({ skills: ["Docker"] })
    assert.equal(response.status, 404)
    assert.equal(query._id, "report-id")
    assert.equal(query.user, USER_ID)
})

test("rejects malformed confirmed skill input", async () => {
    const response = await auth(request(app).patch("/api/interview/report/report-id/confirmed-skills")).send({ skills: "Docker" })
    assert.equal(response.status, 400)
    assert.match(response.body.message, /array/)
})

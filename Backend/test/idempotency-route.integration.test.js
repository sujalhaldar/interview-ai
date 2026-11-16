const test = require("node:test")
const assert = require("node:assert/strict")
const mongoose = require("mongoose")
const jwt = require("jsonwebtoken")
const request = require("supertest")
const { MongoMemoryServer } = require("mongodb-memory-server")
process.env.JWT_SECRET = "idempotency-route-secret"
process.env.GOOGLE_GENAI_API_KEY = "idempotency-route-key"
const pdfParse = require("pdf-parse")
const ai = require("../src/services/ai.service")
const blacklist = require("../src/models/blacklist.model")
const report = require("../src/models/interviewReport.model")
const analysisIdempotencyModel = require("../src/models/analysis-idempotency.model")
const originalPdf = pdfParse.PDFParse
const originalBlacklist = blacklist.findOne
const originalGemini = ai.generateQualitativeResumeAnalysis
const originalCreate = report.create
const firstUser = new mongoose.Types.ObjectId()
const secondUser = new mongoose.Types.ObjectId()
const analysis = { overallSummary: "Summary", experienceAlignment: "Experience", strengths: ["Strength"], areasOfImprovement: ["Improvement"], educationCertificationAnalysis: "Education", resumeQualityAnalysis: "Quality" }
let server
let geminiCalls
let waiting
let app

function cookie(user) { return `token=${jwt.sign({ id: user.toString() }, process.env.JWT_SECRET)}` }
function submit(user, key) { return request(app).post("/api/interview/").set("Cookie", [cookie(user)]).set("X-Expected-User-Id", user.toString()).set("Accept", "text/event-stream").set("Idempotency-Key", key).field("jobDescription", "React role").attach("resume", Buffer.from("pdf"), { filename: "resume.pdf", contentType: "application/pdf" }) }

test.before(async () => {
    server = await MongoMemoryServer.create({ instance: { dbName: `idempotency-route-${Date.now()}` } })
    await mongoose.connect(server.getUri())
    await analysisIdempotencyModel.init()
    pdfParse.PDFParse = class { async getText() { return { text: "resume text" } } }
    blacklist.findOne = async () => null
    ai.generateQualitativeResumeAnalysis = async () => { geminiCalls += 1; return analysis }
    app = require("../src/app")
})
test.beforeEach(async () => { geminiCalls = 0; waiting = false; await report.deleteMany({}) })
test.after(async () => { pdfParse.PDFParse = originalPdf; blacklist.findOne = originalBlacklist; ai.generateQualitativeResumeAnalysis = originalGemini; report.create = originalCreate; await mongoose.disconnect(); await server.stop() })

test("same-user concurrent key runs one analysis and later retry reuses the report", async () => {
    const [first, second] = await Promise.all([submit(firstUser, "concurrent-key"), submit(firstUser, "concurrent-key")])
    assert.ok([200, 409].includes(first.status))
    assert.ok([200, 409].includes(second.status))
    assert.equal(geminiCalls, 1)
    const retry = await submit(firstUser, "concurrent-key")
    assert.equal(retry.status, 200)
    assert.equal(geminiCalls, 1)
    assert.equal(await report.countDocuments({ user: firstUser }), 1)
})

test("same key is isolated per user", async () => {
    const first = await submit(firstUser, "shared-key")
    const second = await submit(secondUser, "shared-key")
    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    assert.equal(geminiCalls, 2)
    assert.equal(await report.countDocuments({}), 2)
})

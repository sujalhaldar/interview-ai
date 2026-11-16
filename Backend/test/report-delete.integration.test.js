const test = require("node:test")
const assert = require("node:assert/strict")
const mongoose = require("mongoose")
const jwt = require("jsonwebtoken")
const request = require("supertest")
const { MongoMemoryServer } = require("mongodb-memory-server")
const pdfParse = require("pdf-parse")
process.env.JWT_SECRET = "delete-test-secret"
process.env.GOOGLE_GENAI_API_KEY = "delete-test-key"
const report = require("../src/models/interviewReport.model")
const idempotency = require("../src/models/analysis-idempotency.model")
const blacklist = require("../src/models/blacklist.model")
const ai = require("../src/services/ai.service")
let app
const owner = new mongoose.Types.ObjectId()
const other = new mongoose.Types.ObjectId()
let server
let geminiCalls = 0
const originalPdfParse = pdfParse.PDFParse
const originalQualitative = ai.generateQualitativeResumeAnalysis
const originalLegacy = ai.generateInterviewReport
function cookie(user) { return `token=${jwt.sign({ id: user.toString() }, process.env.JWT_SECRET)}` }
async function createReport(user = owner) { return report.create({ user, jobDescription: "Role", title: "Role", analysisVersion: "2.0", matchScore: 70 }) }
test.before(async () => { server = await MongoMemoryServer.create({ instance: { dbName: `delete-${Date.now()}` } }); await mongoose.connect(server.getUri()); await report.init(); await idempotency.init(); pdfParse.PDFParse = class { async getText() { return { text: "resume text" } } }; blacklist.findOne = async () => null; ai.generateQualitativeResumeAnalysis = async () => { geminiCalls += 1; return { overallSummary: "Summary", experienceAlignment: "Experience", strengths: ["Strength"], areasOfImprovement: ["Improvement"], educationCertificationAnalysis: "Education", resumeQualityAnalysis: "Quality" } }; ai.generateInterviewReport = async () => { geminiCalls += 1; return {} }; app = require("../src/app") })
test.beforeEach(async () => { geminiCalls = 0; await report.deleteMany({}); await idempotency.deleteMany({}) })
test.after(async () => { pdfParse.PDFParse = originalPdfParse; ai.generateQualitativeResumeAnalysis = originalQualitative; ai.generateInterviewReport = originalLegacy; await mongoose.disconnect(); await server.stop() })

test("owner deletion removes the report from retrieval and history", async () => {
    const created = await createReport()
    const response = await request(app).delete(`/api/interview/report/${created._id}`).set("Cookie", [cookie(owner)]).set("X-Expected-User-Id", owner.toString())
    assert.equal(response.status, 200)
    assert.equal(response.body.interviewReportId, created._id.toString())
    assert.equal((await request(app).get(`/api/interview/report/${created._id}`).set("Cookie", [cookie(owner)]).set("X-Expected-User-Id", owner.toString())).status, 404)
    const history = await request(app).get("/api/interview/").set("Cookie", [cookie(owner)]).set("X-Expected-User-Id", owner.toString())
    assert.equal(history.body.interviewReports.some(item => item._id === created._id.toString()), false)
    assert.equal(geminiCalls, 0)
})

test("deletion validates authentication, IDs, ownership, and concurrent behavior", async () => {
    const created = await createReport()
    const foreign = await createReport(other)
    assert.equal((await request(app).delete(`/api/interview/report/${created._id}`)).status, 401)
    assert.equal((await request(app).delete("/api/interview/report/not-an-id").set("Cookie", [cookie(owner)]).set("X-Expected-User-Id", owner.toString())).status, 404)
    assert.equal((await request(app).delete(`/api/interview/report/${new mongoose.Types.ObjectId()}`).set("Cookie", [cookie(owner)]).set("X-Expected-User-Id", owner.toString())).status, 404)
    assert.equal((await request(app).delete(`/api/interview/report/${foreign._id}`).set("Cookie", [cookie(owner)]).set("X-Expected-User-Id", owner.toString())).status, 404)
    assert.ok(await report.findById(foreign._id))
    const responses = await Promise.all([1, 2].map(() => request(app).delete(`/api/interview/report/${created._id}`).set("Cookie", [cookie(owner)]).set("X-Expected-User-Id", owner.toString())))
    assert.deepEqual(responses.map(item => item.status).sort(), [200, 404])
    assert.equal(await report.findById(created._id), null)
})

test("deletion preserves idempotency records and stale retry can recover", async () => {
    const created = await createReport()
    const key = "completed-delete-key"
    await idempotency.create({ user: owner, key, status: "completed", report: created._id, expiresAt: new Date(Date.now() + 60000) })
    assert.equal((await request(app).delete(`/api/interview/report/${created._id}`).set("Cookie", [cookie(owner)]).set("X-Expected-User-Id", owner.toString())).status, 200)
    assert.ok(await idempotency.findOne({ user: owner, key }))
    assert.equal((await request(app).get(`/api/interview/report/${created._id}`).set("Cookie", [cookie(owner)]).set("X-Expected-User-Id", owner.toString())).status, 404)
    const retry = await request(app).post("/api/interview/").set("Cookie", [cookie(owner)]).set("X-Expected-User-Id", owner.toString()).set("Accept", "text/event-stream").set("Idempotency-Key", key).field("jobDescription", "React role").attach("resume", Buffer.from("pdf"), { filename: "resume.pdf", contentType: "application/pdf" })
    assert.equal(retry.status, 200)
    assert.equal(geminiCalls, 1)
    assert.match(retry.text, /event: complete/)
})

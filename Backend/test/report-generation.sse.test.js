const test = require("node:test")
const assert = require("node:assert/strict")
const jwt = require("jsonwebtoken")
const request = require("supertest")
process.env.JWT_SECRET = "sse-test-secret"
process.env.GOOGLE_GENAI_API_KEY = "sse-test-key"
const pdfParse = require("pdf-parse")
const ai = require("../src/services/ai.service")
const report = require("../src/models/interviewReport.model")
const blacklist = require("../src/models/blacklist.model")
const originalPdf = pdfParse.PDFParse
const originalCreate = report.create
const originalBlacklist = blacklist.findOne
const originalGemini = ai.generateQualitativeResumeAnalysis
let geminiFailure = false
let persisted = false
const validated = { overallSummary: "Summary", experienceAlignment: "Experience", strengths: ["Strength"], areasOfImprovement: ["Improvement"], educationCertificationAnalysis: "Education", resumeQualityAnalysis: "Quality" }
ai.generateQualitativeResumeAnalysis = async () => { if (geminiFailure) throw new Error("provider failure"); return validated }
const app = require("../src/app")

test.beforeEach(() => {
    geminiFailure = false
    persisted = false
    blacklist.findOne = async () => null
    pdfParse.PDFParse = class { async getText() { return { text: "resume text" } } }
    report.create = async document => { persisted = true; return { ...document, _id: "sse-report" } }
})
test.after(() => { pdfParse.PDFParse = originalPdf; report.create = originalCreate; blacklist.findOne = originalBlacklist; ai.generateQualitativeResumeAnalysis = originalGemini })

function cookie() { return `token=${jwt.sign({ id: "sse-user" }, process.env.JWT_SECRET)}` }
function auth(requestBuilder) { return requestBuilder.set("Cookie", [cookie()]).set("X-Expected-User-Id", "sse-user") }

test("streams ordered progress and completion after persistence", async () => {
    const response = await auth(request(app).post("/api/interview/")).set("Accept", "text/event-stream").field("jobDescription", "React role").attach("resume", Buffer.from("pdf"), { filename: "resume.pdf", contentType: "application/pdf" })
    assert.equal(response.status, 200)
    assert.match(response.headers["content-type"], /text\/event-stream/)
    assert.equal(persisted, true)
    const events = [...response.text.matchAll(/event: (\w+)\ndata: ([^\n]+)/g)].map(match => [match[1], JSON.parse(match[2])])
    assert.deepEqual(events.map(([name]) => name), ["progress", "progress", "progress", "progress", "progress", "progress", "complete"])
    assert.equal(events.at(-1)[1].interviewReport._id, "sse-report")
})

test("streams a terminal sanitized error without completion", async () => {
    geminiFailure = true
    const response = await auth(request(app).post("/api/interview/")).set("Accept", "text/event-stream").field("jobDescription", "React role").attach("resume", Buffer.from("pdf"), { filename: "resume.pdf", contentType: "application/pdf" })
    assert.equal(response.status, 200)
    assert.match(response.text, /event: error/)
    assert.doesNotMatch(response.text, /provider failure/)
    assert.doesNotMatch(response.text, /event: complete/)
    assert.equal(persisted, false)
})

test("keeps validation errors as HTTP responses before streaming", async () => {
    const response = await auth(request(app).post("/api/interview/")).set("Accept", "text/event-stream").field("jobDescription", "React role")
    assert.equal(response.status, 400)
    assert.deepEqual(response.body, { message: "Resume PDF is required." })
})

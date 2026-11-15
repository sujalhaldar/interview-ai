const { test, beforeEach, afterEach, after } = require("node:test")
const assert = require("node:assert/strict")
const jwt = require("jsonwebtoken")
const request = require("supertest")

const TEST_SECRET = "report-generation-test-secret"
const USER_ID = "analysis-user-id"
process.env.JWT_SECRET = TEST_SECRET
process.env.GOOGLE_GENAI_API_KEY = "report-generation-test-key"

const pdfParse = require("pdf-parse")
const aiService = require("../src/services/ai.service")
const jdService = require("../src/services/jd-requirements.service")
const resumeEvidenceService = require("../src/services/resume-evidence.service")
const matchingService = require("../src/services/jd-resume-matching.service")
const scoringService = require("../src/services/resume-analysis-scoring.service")
const mapperService = require("../src/services/resume-analysis-report-mapper.service")
const interviewReportModel = require("../src/models/interviewReport.model")
const tokenBlacklistModel = require("../src/models/blacklist.model")

const originalPdfParse = pdfParse.PDFParse
const originalGenerateQualitativeResumeAnalysis = aiService.generateQualitativeResumeAnalysis
const originalGenerateInterviewReport = aiService.generateInterviewReport
const originalCreate = interviewReportModel.create
const originalBlacklistFindOne = tokenBlacklistModel.findOne
const originalJdExtract = jdService.extractJdRequirements
const originalResumeExtract = resumeEvidenceService.extractResumeEvidence
const originalMatch = matchingService.matchJdRequirements
const originalScore = scoringService.assembleResumeAnalysisReport
const originalMap = mapperService.mapResumeAnalysisReport
let generateBehavior = async () => validatedAnalysis
let failureStage = null
const pipelineCalls = []
let qualitativeCallCount = 0
let legacyCallCount = 0
aiService.generateQualitativeResumeAnalysis = (...args) => { qualitativeCallCount += 1; pipelineCalls.push("gemini"); return generateBehavior(...args) }
aiService.generateInterviewReport = (...args) => { legacyCallCount += 1; return originalGenerateInterviewReport(...args) }
jdService.extractJdRequirements = (...args) => { pipelineCalls.push("jd"); if (failureStage === "jd") throw new Error("JD extraction failure") ; return originalJdExtract(...args) }
resumeEvidenceService.extractResumeEvidence = (...args) => { pipelineCalls.push("resume"); if (failureStage === "resume") throw new Error("Resume extraction failure"); return originalResumeExtract(...args) }
matchingService.matchJdRequirements = (...args) => { pipelineCalls.push("matching"); if (failureStage === "matching") throw new Error("Matching failure"); return originalMatch(...args) }
scoringService.assembleResumeAnalysisReport = (...args) => { pipelineCalls.push("scoring"); if (failureStage === "scoring") throw new Error("Scoring failure"); return originalScore(...args) }
mapperService.mapResumeAnalysisReport = (...args) => { pipelineCalls.push("mapping"); if (failureStage === "mapping") throw new Error("Mapping failure"); return originalMap(...args) }
const app = require("../src/app")

const validatedAnalysis = { overallSummary: "Validated analysis summary.", experienceAlignment: "Relevant experience.", strengths: ["Strong skills"], areasOfImprovement: ["Add outcomes"], educationCertificationAnalysis: "No findings.", resumeQualityAnalysis: "Professional." }

function authCookie() {
    return `token=${jwt.sign({ id: USER_ID, username: "test-user" }, TEST_SECRET)}`
}

beforeEach(() => {
    pdfParse.PDFParse = class {
        async getText() {
            return { text: "resume text" }
        }
    }
    tokenBlacklistModel.findOne = async () => null
    generateBehavior = async () => validatedAnalysis
    failureStage = null
    pipelineCalls.length = 0
    qualitativeCallCount = 0
    legacyCallCount = 0
})

afterEach(() => {
    pdfParse.PDFParse = originalPdfParse
    generateBehavior = async () => validatedAnalysis
    interviewReportModel.create = originalCreate
    tokenBlacklistModel.findOne = originalBlacklistFindOne
    jdService.extractJdRequirements = originalJdExtract
    resumeEvidenceService.extractResumeEvidence = originalResumeExtract
    matchingService.matchJdRequirements = originalMatch
    scoringService.assembleResumeAnalysisReport = originalScore
    mapperService.mapResumeAnalysisReport = originalMap
})

after(() => {
    aiService.generateQualitativeResumeAnalysis = originalGenerateQualitativeResumeAnalysis
    aiService.generateInterviewReport = originalGenerateInterviewReport
    delete require.cache[require.resolve("../src/app")]
    delete require.cache[require.resolve("../src/services/ai.service")]
    delete require.cache[require.resolve("../src/models/interviewReport.model")]
    delete require.cache[require.resolve("../src/models/blacklist.model")]
})

test("authenticated report generation persists validated analysis and backend score", async () => {
    let persisted
    generateBehavior = async () => validatedAnalysis
    interviewReportModel.create = async (document) => {
        persisted = document
        return { ...document, _id: "new-report-id" }
    }

    const response = await request(app)
        .post("/api/interview/")
        .set("Cookie", [ authCookie() ])
        .field("jobDescription", "React role")
        .field("selfDescription", "Frontend developer")
        .attach("resume", Buffer.from("fake pdf"), { filename: "resume.pdf", contentType: "application/pdf" })

    assert.equal(response.status, 201)
    assert.equal(persisted.user, USER_ID)
    assert.equal(persisted.resume, "resume text")
    assert.equal(persisted.analysisVersion, "2.0")
    assert.equal(qualitativeCallCount, 1)
    assert.equal(legacyCallCount, 0)
})

test("invalid Gemini JSON returns 502 and does not persist", async () => {
    let createCalled = false
    generateBehavior = async () => { throw new Error("AI response was not valid JSON") }
    interviewReportModel.create = async () => { createCalled = true }

    const response = await request(app)
        .post("/api/interview/")
        .set("Cookie", [ authCookie() ])
        .field("jobDescription", "React role")
        .attach("resume", Buffer.from("fake pdf"), { filename: "resume.pdf", contentType: "application/pdf" })

    assert.equal(response.status, 502)
    assert.deepEqual(response.body, { message: "Resume analysis service is temporarily unavailable." })
    assert.equal(createCalled, false)
})

test("Zod validation failure returns 502 and does not persist", async () => {
    let createCalled = false
    generateBehavior = async () => { throw new Error("AI response failed schema validation") }
    interviewReportModel.create = async () => { createCalled = true }

    const response = await request(app)
        .post("/api/interview/")
        .set("Cookie", [ authCookie() ])
        .field("jobDescription", "React role")
        .attach("resume", Buffer.from("fake pdf"), { filename: "resume.pdf", contentType: "application/pdf" })

    assert.equal(response.status, 502)
    assert.equal(createCalled, false)
})

test("Gemini rejection returns 502 and does not persist", async () => {
    let createCalled = false
    generateBehavior = async () => { throw new Error("upstream Gemini failure") }
    interviewReportModel.create = async () => { createCalled = true }

    const response = await request(app)
        .post("/api/interview/")
        .set("Cookie", [ authCookie() ])
        .field("jobDescription", "React role")
        .attach("resume", Buffer.from("fake pdf"), { filename: "resume.pdf", contentType: "application/pdf" })

    assert.equal(response.status, 502)
    assert.equal(createCalled, false)
})

test("unauthenticated report generation remains protected", async () => {
    const response = await request(app)
        .post("/api/interview/")
        .field("jobDescription", "React role")

    assert.equal(response.status, 401)
})

test("each downstream pipeline failure stops execution and persistence", async () => {
    for (const stage of ["jd", "resume", "matching", "gemini", "scoring", "mapping"]) {
        let createCalled = false
        failureStage = stage
        generateBehavior = async () => { if (stage === "gemini") throw new Error("provider secret should not leak"); return validatedAnalysis }
        interviewReportModel.create = async () => { createCalled = true }
        const response = await request(app)
            .post("/api/interview/")
            .set("Cookie", [ authCookie() ])
            .field("jobDescription", "React role")
            .attach("resume", Buffer.from("fake pdf"), { filename: "resume.pdf", contentType: "application/pdf" })
        assert.equal(response.status, 502)
        assert.deepEqual(response.body, { message: "Resume analysis service is temporarily unavailable." })
        assert.equal(createCalled, false)
        const index = pipelineCalls.indexOf(stage)
        assert.ok(index >= 0)
        assert.equal(pipelineCalls.slice(index + 1).length, 0)
        assert.equal(qualitativeCallCount, ["gemini", "scoring", "mapping"].includes(stage) ? 1 : 0)
        assert.equal(qualitativeCallCount <= 1, true)
        pipelineCalls.length = 0
        qualitativeCallCount = 0
        failureStage = null
    }
})

test("PDF extraction failure is sanitized and prevents all later stages", async () => {
    let createCalled = false
    interviewReportModel.create = async () => { createCalled = true }
    pdfParse.PDFParse = class { async getText() { throw new Error("private resume text") } }
    const response = await request(app)
        .post("/api/interview/")
        .set("Cookie", [ authCookie() ])
        .field("jobDescription", "React role")
        .attach("resume", Buffer.from("fake pdf"), { filename: "resume.pdf", contentType: "application/pdf" })
    assert.equal(response.status, 400)
    assert.deepEqual(response.body, { message: "Resume analysis service is temporarily unavailable." })
    assert.equal(createCalled, false)
    assert.deepEqual(pipelineCalls, [])
})

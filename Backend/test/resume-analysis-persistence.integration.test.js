const test = require("node:test")
const assert = require("node:assert/strict")
const mongoose = require("mongoose")
const { MongoMemoryServer } = require("mongodb-memory-server")
const interviewReportModel = require("../src/models/interviewReport.model")
const analysisIdempotencyModel = require("../src/models/analysis-idempotency.model")

let mongoServer
let ownerId
let otherUserId

test.before(async () => {
    mongoServer = await MongoMemoryServer.create({
        instance: { dbName: `interview-ai-test-${Date.now()}` }
    })
    await mongoose.connect(mongoServer.getUri())
    await analysisIdempotencyModel.init()
    ownerId = new mongoose.Types.ObjectId()
    otherUserId = new mongoose.Types.ObjectId()
})

test.after(async () => {
    await mongoose.disconnect()
    if (mongoServer) await mongoServer.stop()
})

test.beforeEach(async () => {
    await interviewReportModel.deleteMany({})
    await analysisIdempotencyModel.deleteMany({})
})

test("enforces user-scoped idempotency uniqueness and permits failed retries", async () => {
    const expiresAt = new Date(Date.now() + 60_000)
    await analysisIdempotencyModel.create({ user: ownerId, key: "same-key", status: "processing", expiresAt })
    await assert.rejects(() => analysisIdempotencyModel.create({ user: ownerId, key: "same-key", status: "processing", expiresAt }), error => error.code === 11000)
    const other = await analysisIdempotencyModel.create({ user: otherUserId, key: "same-key", status: "processing", expiresAt })
    assert.equal(other.key, "same-key")
    await analysisIdempotencyModel.updateOne({ user: ownerId, key: "same-key" }, { $set: { status: "failed" } })
    await analysisIdempotencyModel.deleteOne({ user: ownerId, key: "same-key" })
    assert.equal((await analysisIdempotencyModel.create({ user: ownerId, key: "same-key", status: "processing", expiresAt })).status, "processing")
})

test("persists and retrieves a V2 report with nested evidence", async () => {
    const report = await interviewReportModel.create({
        analysisVersion: "2.0",
        jobDescription: "Senior JavaScript engineer",
        resume: "resume.pdf",
        title: "Senior Engineer",
        user: ownerId,
        matchScore: 82,
        categoryScores: [{ category: "requiredTechnicalSkills", score: 90, weight: 40, applicableRequirementCount: 1 }],
        requirementAnalysis: {
            requirements: [{
                originalText: "JavaScript",
                normalizedName: "JavaScript",
                category: "programmingLanguage",
                requirementType: "required",
                sourceEvidence: "Strong JavaScript required",
                scoringCategory: "requiredTechnicalSkills",
                status: "matched",
                matchedEvidence: [{ originalText: "JavaScript", sourceType: "skillsSection", evidenceText: "JavaScript" }],
                explanation: "Explicitly listed"
            }],
            matchedRequirements: [],
            partialRequirements: [],
            missingRequirements: [],
            needsVerificationRequirements: []
        },
        overallSummary: "Strong fit",
        experienceAlignment: "Relevant experience",
        educationCertificationAnalysis: "Education evidence reviewed",
        resumeQualityAnalysis: "Clear and readable",
        confirmedSkills: [{ originalText: "TypeScript", normalizedName: "TypeScript", sourceType: "userConfirmed", confidence: "userConfirmed" }],
        analysisRevision: 2
    })

    const retrieved = await interviewReportModel.findOne({ _id: report._id, user: ownerId }).lean()
    assert.equal(retrieved.analysisVersion, "2.0")
    assert.equal(retrieved.matchScore, 82)
    assert.equal(retrieved.categoryScores[0].score, 90)
    assert.equal(retrieved.requirementAnalysis.requirements[0].matchedEvidence[0].sourceType, "skillsSection")
    assert.equal(retrieved.confirmedSkills[0].normalizedName, "TypeScript")
    assert.equal(retrieved.analysisRevision, 2)
    assert.equal(JSON.parse(JSON.stringify(retrieved)).requirementAnalysis.requirements.length, 1)
})

test("preserves historical V1 fields and legacy structured analysis", async () => {
    const report = await interviewReportModel.create({
        analysisVersion: "1.0",
        jobDescription: "Full-stack developer",
        title: "Developer",
        user: ownerId,
        matchScore: 60,
        experienceAlignment: { status: "aligned", alignedEvidence: ["Node.js role"], gaps: [], explanation: "Aligned" },
        educationCertificationAnalysis: { educationFindings: ["BSc"], certificationFindings: ["AWS"], explanation: "Reviewed" },
        categoryAssessments: [{ category: "relevantExperience", score: 60, evidence: ["Role"], explanation: "Relevant" }],
        eligibility: { minimumExperience: { status: "Met", explanation: "Meets" } },
        technicalQuestions: [{ question: "What is Node.js?", intention: "Fundamentals", answer: "Runtime" }],
        behavioralQuestions: [{ question: "Tell me about a challenge", intention: "Behavior", answer: "Example" }],
        preparationPlan: [{ day: 1, focus: "JavaScript", tasks: ["Review" ] }]
    })
    const retrieved = await interviewReportModel.findById(report._id).lean()
    assert.equal(retrieved.experienceAlignment.status, "aligned")
    assert.deepEqual(retrieved.educationCertificationAnalysis.educationFindings, ["BSc"])
    assert.equal(retrieved.technicalQuestions[0].question, "What is Node.js?")
    assert.equal(retrieved.behavioralQuestions[0].answer, "Example")
    assert.equal(retrieved.preparationPlan[0].day, 1)
})

test("enforces owner-filtered retrieval", async () => {
    const report = await interviewReportModel.create({ jobDescription: "JD", title: "Role", user: ownerId })
    assert.ok(await interviewReportModel.findOne({ _id: report._id, user: ownerId }))
    assert.equal(await interviewReportModel.findOne({ _id: report._id, user: otherUserId }), null)
})

test("persists confirmed skills and analysis revision updates", async () => {
    const report = await interviewReportModel.create({ analysisVersion: "2.0", jobDescription: "JD", title: "Role", user: ownerId })
    await interviewReportModel.updateOne({ _id: report._id, user: ownerId }, {
        $set: {
            confirmedSkills: [{ originalText: "AWS", normalizedName: "AWS", sourceType: "userConfirmed", confidence: "userConfirmed" }],
            analysisRevision: 1
        }
    })
    const updated = await interviewReportModel.findOne({ _id: report._id, user: ownerId }).lean()
    assert.equal(updated.confirmedSkills[0].normalizedName, "AWS")
    assert.equal(updated.analysisRevision, 1)
})

test("persists history metadata and preserves V1/V2 reports without it", async () => {
    const pinnedAt = new Date("2026-11-16T10:00:00.000Z")
    const lastOpenedAt = new Date("2026-11-16T11:00:00.000Z")
    const v2 = await interviewReportModel.create({ analysisVersion: "2.0", jobDescription: "React role", title: "Engineer", isPinned: true, pinnedAt, lastOpenedAt })
    const v1 = await interviewReportModel.create({ analysisVersion: "1.0", jobDescription: "Legacy role", title: "Engineer", categoryAssessments: [] })
    const v2Historical = await interviewReportModel.create({ analysisVersion: "2.0", jobDescription: "Historical role", title: "Engineer" })

    const persisted = await interviewReportModel.findById(v2._id).lean()
    assert.equal(persisted.isPinned, true)
    assert.equal(persisted.pinnedAt.toISOString(), pinnedAt.toISOString())
    assert.equal(persisted.lastOpenedAt.toISOString(), lastOpenedAt.toISOString())

    for (const id of [v1._id, v2Historical._id]) {
        const historical = await interviewReportModel.findById(id)
        assert.ok(historical)
        assert.equal(historical.isPinned, false)
        assert.equal(historical.pinnedAt, null)
        assert.equal(historical.lastOpenedAt, null)
        assert.ok(historical.toJSON())
    }
})

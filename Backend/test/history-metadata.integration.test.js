const test = require("node:test")
const assert = require("node:assert/strict")
const mongoose = require("mongoose")
const jwt = require("jsonwebtoken")
const request = require("supertest")
const { MongoMemoryServer } = require("mongodb-memory-server")
process.env.JWT_SECRET = "history-test-secret"
process.env.GOOGLE_GENAI_API_KEY = "history-test-key"
const report = require("../src/models/interviewReport.model")
const blacklist = require("../src/models/blacklist.model")
const app = require("../src/app")
const owner = new mongoose.Types.ObjectId()
const other = new mongoose.Types.ObjectId()
let server
function cookie(user) { return `token=${jwt.sign({ id: user.toString() }, process.env.JWT_SECRET)}` }
async function create(data = {}) { return report.create({ user: owner, jobDescription: "Role", title: "Role", analysisVersion: "2.0", ...data }) }
test.before(async () => { server = await MongoMemoryServer.create({ instance: { dbName: `history-${Date.now()}` } }); await mongoose.connect(server.getUri()); await report.init(); blacklist.findOne = async () => null })
test.after(async () => { await mongoose.disconnect(); await server.stop() })
test.beforeEach(async () => { await report.deleteMany({}) })

test("history sorts pinned first, then by the effective unpinned open date", async () => {
    const pinnedOld = await create({ title: "Pinned old", isPinned: true, pinnedAt: new Date("2026-01-01"), createdAt: new Date("2026-01-05") })
    const pinnedNew = await create({ title: "Pinned new", isPinned: true, pinnedAt: new Date("2026-02-01"), createdAt: new Date("2026-02-05") })
    const unpinnedOld = await create({ title: "Unpinned old", lastOpenedAt: new Date("2026-01-10"), createdAt: new Date("2026-03-01") })
    const unpinnedNew = await create({ title: "Unpinned new", lastOpenedAt: new Date("2026-02-10"), createdAt: new Date("2026-01-01") })
    await create({ title: "Historical", createdAt: new Date("2026-04-01") })
    await report.create({ user: other, jobDescription: "Other", title: "Other", analysisVersion: "2.0" })
    const response = await request(app).get("/api/interview/").set("Cookie", [cookie(owner)])
    assert.equal(response.status, 200)
    assert.deepEqual(response.body.interviewReports.map(item => item.title), [pinnedNew.title, pinnedOld.title, "Historical", unpinnedNew.title, unpinnedOld.title])
    assert.equal(response.body.interviewReports.some(item => item.jobDescription), false)
})

test("sorts genuinely legacy documents with deterministic date and ID tie-breakers", async () => {
    const ids = ["000000000000000000000001", "000000000000000000000002", "000000000000000000000003", "000000000000000000000004", "000000000000000000000005"].map(value => new mongoose.Types.ObjectId(value))
    await report.collection.insertMany([
        { _id: ids[0], user: owner, title: "Pinned older", jobDescription: "private", isPinned: true, pinnedAt: new Date("2026-02-01"), createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01") },
        { _id: ids[1], user: owner, title: "Pinned newer", jobDescription: "private", isPinned: true, pinnedAt: new Date("2026-03-01"), createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01") },
        { _id: ids[2], user: owner, title: "Equal date lower ID", jobDescription: "private", createdAt: new Date("2026-03-01"), lastOpenedAt: new Date("2026-05-01"), updatedAt: new Date("2026-05-01") },
        { _id: ids[3], user: owner, title: "Equal date higher ID", jobDescription: "private", createdAt: new Date("2026-03-01"), lastOpenedAt: new Date("2026-05-01"), updatedAt: new Date("2026-05-01") },
        { _id: ids[4], user: owner, title: "Legacy fallback", jobDescription: "private", createdAt: new Date("2026-06-01"), updatedAt: new Date("2026-06-01") }
    ])
    await report.collection.insertOne({ _id: new mongoose.Types.ObjectId("000000000000000000000006"), user: owner, title: "Explicit null fallback", jobDescription: "private", isPinned: false, lastOpenedAt: null, createdAt: new Date("2026-05-15"), updatedAt: new Date("2026-05-15") })
    const response = await request(app).get("/api/interview/").set("Cookie", [cookie(owner)])
    assert.equal(response.status, 200)
    assert.deepEqual(response.body.interviewReports.map(item => item.title), ["Pinned newer", "Pinned older", "Legacy fallback", "Explicit null fallback", "Equal date higher ID", "Equal date lower ID"])
    for (const item of response.body.interviewReports) {
        assert.equal("historyPinned" in item, false)
        assert.equal("historyDate" in item, false)
    }
})

test("history response is owner-scoped and excludes every sensitive field", async () => {
    await report.collection.insertOne({
        _id: new mongoose.Types.ObjectId(), user: owner, title: "Safe summary", jobDescription: "JD", resume: "resume", selfDescription: "self",
        technicalQuestions: [{ question: "Q", intention: "I", answer: "A" }], behavioralQuestions: [{ question: "Q", intention: "I", answer: "A" }],
        skillGaps: [{ skill: "Docker", severity: "high" }], preparationPlan: [{ day: 1, focus: "Focus", tasks: ["Task"] }], createdAt: new Date(), updatedAt: new Date()
    })
    await report.collection.insertOne({ _id: new mongoose.Types.ObjectId(), user: other, title: "Other user", jobDescription: "private", createdAt: new Date(), updatedAt: new Date() })
    const response = await request(app).get("/api/interview/").set("Cookie", [cookie(owner)])
    assert.equal(response.status, 200)
    assert.deepEqual(response.body.interviewReports.map(item => item.title), ["Safe summary"])
    const [item] = response.body.interviewReports
    for (const field of ["resume", "selfDescription", "jobDescription", "technicalQuestions", "behavioralQuestions", "skillGaps", "preparationPlan", "historyPinned", "historyDate"]) assert.equal(field in item, false)
})

test("report retrieval updates only lastOpenedAt after ownership verification", async () => {
    const createdAt = new Date("2026-01-01")
    const pinnedAt = new Date("2026-01-02")
    const lastOpenedAt = new Date("2026-01-03")
    const created = await create({ isPinned: true, pinnedAt, lastOpenedAt, createdAt, matchScore: 80, analysisRevision: 2 })
    const before = await report.findById(created._id).lean()
    const response = await request(app).get(`/api/interview/report/${created._id}`).set("Cookie", [cookie(owner)])
    assert.equal(response.status, 200)
    const after = await report.findById(created._id).lean()
    assert.ok(after.lastOpenedAt >= before.lastOpenedAt)
    const firstOpenedAt = after.lastOpenedAt
    await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal((await request(app).get(`/api/interview/report/${created._id}`).set("Cookie", [cookie(owner)])).status, 200)
    const afterSecondOpen = await report.findById(created._id).lean()
    assert.ok(afterSecondOpen.lastOpenedAt > firstOpenedAt)
    assert.deepEqual({ isPinned: afterSecondOpen.isPinned, pinnedAt: afterSecondOpen.pinnedAt, createdAt: afterSecondOpen.createdAt, matchScore: afterSecondOpen.matchScore, analysisRevision: afterSecondOpen.analysisRevision }, { isPinned: true, pinnedAt: before.pinnedAt, createdAt: before.createdAt, matchScore: 80, analysisRevision: 2 })
    assert.deepEqual(afterSecondOpen.confirmedSkills, before.confirmedSkills)
    assert.equal((await request(app).get(`/api/interview/report/${created._id}`).set("Cookie", [cookie(other)])).status, 404)
    assert.equal((await request(app).get(`/api/interview/report/${new mongoose.Types.ObjectId()}`).set("Cookie", [cookie(owner)])).status, 404)
    assert.equal((await request(app).get("/api/interview/report/bad-id").set("Cookie", [cookie(owner)])).status, 404)
    assert.equal((await request(app).get(`/api/interview/report/${created._id}`)).status, 401)
})

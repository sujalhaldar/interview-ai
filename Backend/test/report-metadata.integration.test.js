const test = require("node:test")
const assert = require("node:assert/strict")
const mongoose = require("mongoose")
const jwt = require("jsonwebtoken")
const request = require("supertest")
const { MongoMemoryServer } = require("mongodb-memory-server")
process.env.JWT_SECRET = "metadata-test-secret"
process.env.GOOGLE_GENAI_API_KEY = "metadata-test-key"
const report = require("../src/models/interviewReport.model")
const blacklist = require("../src/models/blacklist.model")
const ai = require("../src/services/ai.service")
const app = require("../src/app")
let server
let qualitativeCalls = 0
let legacyCalls = 0
const originalQualitative = ai.generateQualitativeResumeAnalysis
const originalLegacy = ai.generateInterviewReport
const owner = new mongoose.Types.ObjectId()
const other = new mongoose.Types.ObjectId()
function cookie(user) { return `token=${jwt.sign({ id: user.toString() }, process.env.JWT_SECRET)}` }
function auth(requestBuilder, user) { return requestBuilder.set("Cookie", [cookie(user)]).set("X-Expected-User-Id", user.toString()).set("Origin", "http://localhost:5173") }
async function createReport(user = owner) { return report.create({ user, jobDescription: "Role", title: "Original", analysisVersion: "2.0" }) }
test.before(async () => { server = await MongoMemoryServer.create({ instance: { dbName: `metadata-${Date.now()}` } }); await mongoose.connect(server.getUri()); await report.init(); blacklist.findOne = async () => null })
test.after(async () => { ai.generateQualitativeResumeAnalysis = originalQualitative; ai.generateInterviewReport = originalLegacy; await mongoose.disconnect(); await server.stop() })
test.beforeEach(() => {
    qualitativeCalls = 0
    legacyCalls = 0
    ai.generateQualitativeResumeAnalysis = (...args) => { qualitativeCalls += 1; return originalQualitative(...args) }
    ai.generateInterviewReport = (...args) => { legacyCalls += 1; return originalLegacy(...args) }
})
test("owner can rename with trimming and duplicate titles are allowed", async () => {
    const first = await createReport(); const second = await createReport()
    const response = await auth(request(app).patch(`/api/interview/report/${first._id}/title`), owner).send({ title: "  Renamed  " })
    assert.equal(response.status, 200); assert.equal(response.body.interviewReport.title, "Renamed")
    const duplicate = await auth(request(app).patch(`/api/interview/report/${second._id}/title`), owner).send({ title: "Renamed" })
    assert.equal(duplicate.status, 200)
})
test("rename validates input and ownership", async () => {
    const owned = await createReport(); const foreign = await createReport(other)
    for (const title of ["", "   ", 42, null, "x".repeat(161)]) {
        const response = await auth(request(app).patch(`/api/interview/report/${owned._id}/title`), owner).send({ title })
        assert.equal(response.status, 400)
    }
    assert.equal((await auth(request(app).patch(`/api/interview/report/${foreign._id}/title`), owner).send({ title: "Nope" })).status, 404)
    assert.equal((await auth(request(app).patch("/api/interview/report/bad-id/title"), owner).send({ title: "Nope" })).status, 400)
})
test("pinning is boolean, owner-scoped, and preserves timestamps", async () => {
    const owned = await createReport(); const foreign = await createReport(other)
    for (const value of ["true", "false", 1, null, undefined]) {
        const body = value === undefined ? {} : { isPinned: value }
        assert.equal((await auth(request(app).patch(`/api/interview/report/${owned._id}/pin`), owner).send(body)).status, 400)
    }
    const pinned = await auth(request(app).patch(`/api/interview/report/${owned._id}/pin`), owner).send({ isPinned: true })
    assert.equal(pinned.status, 200); const firstPinnedAt = pinned.body.interviewReport.pinnedAt
    const repeated = await auth(request(app).patch(`/api/interview/report/${owned._id}/pin`), owner).send({ isPinned: true })
    assert.equal(new Date(repeated.body.interviewReport.pinnedAt).toISOString(), new Date(firstPinnedAt).toISOString())
    assert.equal((await auth(request(app).patch(`/api/interview/report/${owned._id}/pin`), owner).send({ isPinned: false })).body.interviewReport.pinnedAt, null)
    assert.equal((await auth(request(app).patch(`/api/interview/report/${foreign._id}/pin`), owner).send({ isPinned: true })).status, 404)
})

test("requires authentication and does not modify metadata", async () => {
    const created = await createReport()
    const before = await report.findById(created._id).lean()
    assert.equal((await request(app).patch(`/api/interview/report/${created._id}/title`).send({ title: "Blocked" })).status, 401)
    assert.equal((await request(app).patch(`/api/interview/report/${created._id}/pin`).send({ isPinned: true })).status, 401)
    const after = await report.findById(created._id).lean()
    assert.deepEqual({ title: after.title, isPinned: after.isPinned, pinnedAt: after.pinnedAt }, { title: before.title, isPinned: before.isPinned, pinnedAt: before.pinnedAt })
})

test("returns 404 for nonexistent valid report IDs", async () => {
    const missing = new mongoose.Types.ObjectId()
    assert.equal((await auth(request(app).patch(`/api/interview/report/${missing}/title`), owner).send({ title: "Missing" })).status, 404)
    assert.equal((await auth(request(app).patch(`/api/interview/report/${missing}/pin`), owner).send({ isPinned: true })).status, 404)
})

test("repeated unpin remains stable and preserves unrelated fields", async () => {
    const created = await report.create({ user: owner, jobDescription: "Role", title: "Original", analysisVersion: "2.0", matchScore: 82, confirmedSkills: [{ originalText: "JS", normalizedName: "JavaScript", sourceType: "userConfirmed", confidence: "userConfirmed" }], analysisRevision: 3, isPinned: true, pinnedAt: new Date("2026-11-16T10:00:00.000Z"), lastOpenedAt: new Date("2026-11-16T11:00:00.000Z") })
    const before = await report.findById(created._id).lean()
    const first = await auth(request(app).patch(`/api/interview/report/${created._id}/pin`), owner).send({ isPinned: false })
    assert.equal(first.status, 200)
    const afterFirst = await report.findById(created._id).lean()
    const second = await auth(request(app).patch(`/api/interview/report/${created._id}/pin`), owner).send({ isPinned: false })
    assert.equal(second.status, 200)
    const afterSecond = await report.findById(created._id).lean()
    assert.equal(afterSecond.isPinned, false)
    assert.equal(afterSecond.pinnedAt, null)
    for (const field of ["title", "matchScore", "analysisRevision", "lastOpenedAt", "createdAt"]) assert.deepEqual(afterSecond[field], before[field])
    assert.deepEqual(afterSecond.confirmedSkills, before.confirmedSkills)
    assert.deepEqual({ isPinned: afterFirst.isPinned, pinnedAt: afterFirst.pinnedAt }, { isPinned: false, pinnedAt: null })
})

test("preserves unrelated fields when renaming", async () => {
    const created = await report.create({ user: owner, jobDescription: "Role", title: "Original", analysisVersion: "2.0", matchScore: 71, confirmedSkills: [{ originalText: "JS", normalizedName: "JavaScript", sourceType: "userConfirmed", confidence: "userConfirmed" }], analysisRevision: 2, isPinned: true, pinnedAt: new Date("2026-11-16T10:00:00.000Z"), lastOpenedAt: new Date("2026-11-16T11:00:00.000Z") })
    const before = await report.findById(created._id).lean()
    assert.equal((await auth(request(app).patch(`/api/interview/report/${created._id}/title`), owner).send({ title: "Renamed" })).status, 200)
    const after = await report.findById(created._id).lean()
    assert.equal(after.title, "Renamed")
    for (const field of ["matchScore", "analysisRevision", "isPinned", "pinnedAt", "lastOpenedAt", "createdAt"]) assert.deepEqual(after[field], before[field])
    assert.deepEqual(after.confirmedSkills, before.confirmedSkills)
})

test("concurrent pin and unpin operations leave consistent metadata", async () => {
    const pinned = await createReport()
    await Promise.all(Array.from({ length: 4 }, () => auth(request(app).patch(`/api/interview/report/${pinned._id}/pin`), owner).send({ isPinned: true })))
    const pinnedState = await report.findById(pinned._id).lean()
    assert.equal(pinnedState.isPinned, true)
    assert.ok(pinnedState.pinnedAt instanceof Date)

    const unpinned = await createReport()
    await Promise.all(Array.from({ length: 4 }, () => auth(request(app).patch(`/api/interview/report/${unpinned._id}/pin`), owner).send({ isPinned: false })))
    const unpinnedState = await report.findById(unpinned._id).lean()
    assert.equal(unpinnedState.isPinned, false)
    assert.equal(unpinnedState.pinnedAt, null)

    const mixed = await createReport()
    await Promise.all([true, false, true, false, true].map(value => auth(request(app).patch(`/api/interview/report/${mixed._id}/pin`), owner).send({ isPinned: value })))
    const mixedState = await report.findById(mixed._id).lean()
    assert.equal(typeof mixedState.isPinned, "boolean")
    if (mixedState.isPinned) assert.ok(mixedState.pinnedAt instanceof Date)
    else assert.equal(mixedState.pinnedAt, null)
})

test("metadata endpoints do not invoke either Gemini generator", async () => {
    const created = await createReport()
    await auth(request(app).patch(`/api/interview/report/${created._id}/title`), owner).send({ title: "No AI" })
    await auth(request(app).patch(`/api/interview/report/${created._id}/pin`), owner).send({ isPinned: true })
    await auth(request(app).patch(`/api/interview/report/${created._id}/pin`), owner).send({ isPinned: false })
    assert.equal(qualitativeCalls, 0)
    assert.equal(legacyCalls, 0)
})

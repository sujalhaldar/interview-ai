const test = require("node:test")
const assert = require("node:assert/strict")
const jwt = require("jsonwebtoken")
const request = require("supertest")

process.env.JWT_SECRET = "csrf-test-secret"
process.env.GOOGLE_GENAI_API_KEY = "csrf-test-key"
const app = require("../src/app")
const reportModel = require("../src/models/interviewReport.model")
const blacklistModel = require("../src/models/blacklist.model")
const authConfig = require("../src/config/auth.config")

const reportId = "507f1f77bcf86cd799439011"
const userId = "csrf-user"
const token = jwt.sign({ id: userId }, process.env.JWT_SECRET)
const originalFindOneAndUpdate = reportModel.findOneAndUpdate
const originalBlacklistCreate = blacklistModel.create
const originalBlacklistFindOne = blacklistModel.findOne

test.beforeEach(() => {
    reportModel.findOneAndUpdate = async () => ({ _id: reportId, user: userId, title: "Updated" })
    blacklistModel.create = async () => ({})
    blacklistModel.findOne = async () => null
})

test.after(() => {
    reportModel.findOneAndUpdate = originalFindOneAndUpdate
    blacklistModel.create = originalBlacklistCreate
    blacklistModel.findOne = originalBlacklistFindOne
})

function authenticatedTitleRequest() {
    return request(app)
        .patch(`/api/interview/report/${reportId}/title`)
        .set("Cookie", [`token=${token}`])
        .set("X-Expected-User-Id", userId)
        .send({ title: "Updated" })
}

test("allows an authenticated state change from the configured frontend origin", async () => {
    const response = await authenticatedTitleRequest().set("Origin", "http://localhost:5173")
    assert.equal(response.status, 200)
})

test("normalizes a configured trailing slash to the canonical origin", async () => {
    const originalOrigins = process.env.CSRF_ALLOWED_ORIGINS
    process.env.CSRF_ALLOWED_ORIGINS = "http://localhost:5173/"
    try {
        assert.deepEqual(authConfig.getAllowedCsrfOrigins(), ["http://localhost:5173"])
        const response = await authenticatedTitleRequest().set("Origin", "http://localhost:5173")
        assert.equal(response.status, 200)
    } finally {
        if (originalOrigins === undefined) delete process.env.CSRF_ALLOWED_ORIGINS
        else process.env.CSRF_ALLOWED_ORIGINS = originalOrigins
    }
})

for (const [name, value, message] of [
    ["empty origin", "   ", /empty origin/],
    ["literal null", "null", /literal null/],
    ["wildcard", "https://*.example.test", /wildcard/],
    ["malformed URL", "not-a-url", /malformed/],
    ["non-HTTP scheme", "ftp://example.test", /HTTP\/HTTPS/],
    ["path", "https://example.test/account", /path/],
    ["normalized path", "https://example.test/..", /path/],
    ["query", "https://example.test/?next=account", /query/],
    ["fragment", "https://example.test/#account", /fragment/],
    ["embedded credentials", "https://user:password@example.test", /credentials/]
]) {
    test(`rejects ${name} in CSRF configuration`, () => {
        const originalOrigins = process.env.CSRF_ALLOWED_ORIGINS
        process.env.CSRF_ALLOWED_ORIGINS = value
        try {
            assert.throws(() => authConfig.getAllowedCsrfOrigins(), message)
            assert.throws(() => authConfig.assertCsrfOriginsConfigured(), message)
        } finally {
            if (originalOrigins === undefined) delete process.env.CSRF_ALLOWED_ORIGINS
            else process.env.CSRF_ALLOWED_ORIGINS = originalOrigins
        }
    })
}

test("falls back to an allowed Referer when Origin is unavailable", async () => {
    const response = await authenticatedTitleRequest().set("Referer", "http://localhost:5173/account")
    assert.equal(response.status, 200)
})

for (const [name, headers] of [
    ["null origin", { Origin: "null" }],
    ["untrusted origin", { Origin: "https://attacker.example" }],
    ["missing origin and referer", {}],
    ["malformed referer", { Referer: "not-a-url" }]
]) {
    test(`rejects ${name} before the controller executes`, async () => {
        let controllerCalled = false
        reportModel.findOneAndUpdate = async () => { controllerCalled = true; return null }
        const response = await authenticatedTitleRequest().set(headers)
        assert.equal(response.status, 403)
        assert.deepEqual(response.body, { message: "CSRF validation failed." })
        assert.equal(controllerCalled, false)
    })
}

test("GET logout is no longer a state-changing route", async () => {
    const response = await request(app).get("/api/auth/logout")
    assert.equal(response.status, 404)
})

test("POST logout accepts the configured origin and clears the session", async () => {
    const response = await request(app)
        .post("/api/auth/logout")
        .set("Origin", "http://localhost:5173")
    assert.equal(response.status, 200)
    assert.match(response.headers["set-cookie"][0], /^token=/)
})

test("POST logout rejects an untrusted origin without revoking or clearing the session", async () => {
    let blacklistWrites = 0
    blacklistModel.create = async () => {
        blacklistWrites += 1
        return {}
    }

    const response = await request(app)
        .post("/api/auth/logout")
        .set("Cookie", [`token=${token}`])
        .set("Origin", "https://attacker.example")

    assert.equal(response.status, 403)
    assert.equal(blacklistWrites, 0)
    assert.equal(response.headers["set-cookie"], undefined)
})

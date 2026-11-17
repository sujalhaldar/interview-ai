const test = require("node:test")
const assert = require("node:assert/strict")
const jwt = require("jsonwebtoken")
const request = require("supertest")

const TEST_JWT_SECRET = "jwt-security-test-secret"
process.env.JWT_SECRET = TEST_JWT_SECRET
process.env.GOOGLE_GENAI_API_KEY = "jwt-security-test-key"
const app = require("../src/app")
const tokenBlacklistModel = require("../src/models/blacklist.model")
const userModel = require("../src/models/user.model")
const interviewReportModel = require("../src/models/interviewReport.model")
const authConfig = require("../src/config/auth.config")

const originalBlacklistFindOne = tokenBlacklistModel.findOne
const originalUserFindById = userModel.findById
const originalAggregate = interviewReportModel.aggregate

test.beforeEach(() => {
    tokenBlacklistModel.findOne = async () => null
    userModel.findById = async id => ({ _id: id, username: id, email: `${id}@example.test` })
    interviewReportModel.aggregate = async () => []
})

test.after(() => {
    tokenBlacklistModel.findOne = originalBlacklistFindOne
    userModel.findById = originalUserFindById
    interviewReportModel.aggregate = originalAggregate
})

test("session cookie options are explicit and localhost-compatible", () => {
    const originalNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = "development"
    assert.deepEqual(authConfig.getSessionCookieOptions(), {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        path: "/",
        maxAge: authConfig.JWT_MAX_AGE_MS
    })
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
})

test("production session cookie options require HTTPS", () => {
    const originalNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = "production"
    const options = authConfig.getSessionCookieOptions()
    assert.equal(options.httpOnly, true)
    assert.equal(options.secure, true)
    assert.equal(options.sameSite, "lax")
    assert.equal(options.path, "/")
    assert.equal(options.maxAge, authConfig.JWT_MAX_AGE_MS)
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
})

test("missing JWT secret fails configuration validation", () => {
    const originalSecret = process.env.JWT_SECRET
    delete process.env.JWT_SECRET
    assert.throws(() => authConfig.assertJwtSecretConfigured(), /JWT_SECRET is not configured/)
    if (originalSecret === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = originalSecret
})

test("valid JWT authenticates with the expected identity", async () => {
    const token = jwt.sign({ id: "user-a", username: "user-a" }, TEST_JWT_SECRET, { algorithm: authConfig.JWT_ALGORITHM })
    const response = await request(app)
        .get("/api/interview/")
        .set("Cookie", [`token=${token}`])
        .set("X-Expected-User-Id", "user-a")
    assert.equal(response.status, 200)
})

for (const [name, token] of [
    ["expired", jwt.sign({ id: "user-a" }, TEST_JWT_SECRET, { algorithm: authConfig.JWT_ALGORITHM, expiresIn: -1 })],
    ["malformed", "not-a-jwt"],
    ["invalid signature", jwt.sign({ id: "user-a" }, "different-secret", { algorithm: authConfig.JWT_ALGORITHM })],
    ["wrong algorithm", jwt.sign({ id: "user-a" }, TEST_JWT_SECRET, { algorithm: "HS384" })]
]) {
    test(`rejects ${name} JWTs`, async () => {
        const response = await request(app)
            .get("/api/interview/")
            .set("Cookie", [`token=${token}`])
            .set("X-Expected-User-Id", "user-a")
        assert.equal(response.status, 401)
    })
}

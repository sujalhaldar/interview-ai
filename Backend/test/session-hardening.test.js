const test = require("node:test")
const assert = require("node:assert/strict")
const { spawnSync } = require("node:child_process")
const path = require("node:path")
const jwt = require("jsonwebtoken")
const request = require("supertest")

process.env.JWT_SECRET = "session-hardening-test-secret"
process.env.GOOGLE_GENAI_API_KEY = "session-hardening-test-key"

const { hashToken, getVerifiedTokenExpiry } = require("../src/services/token-blacklist.service")
const blacklistModel = require("../src/models/blacklist.model")
const userModel = require("../src/models/user.model")
const reportModel = require("../src/models/interviewReport.model")
const googleAuthService = require("../src/services/google-auth.service")
const {
    googleAuthRateLimit,
    resetGoogleAuthRateLimit,
    cleanupExpiredRateLimitEntries,
    getGoogleAuthRateLimitConfig,
    assertGoogleAuthRateLimitConfig,
    getTrackedRateLimitClientCount
} = require("../src/middlewares/rate-limit.middleware")
const app = require("../src/app")

const token = jwt.sign({ id: "user-a", username: "user-a" }, process.env.JWT_SECRET, { expiresIn: "1h" })
const originalBlacklistFindOne = blacklistModel.findOne
const originalBlacklistCreate = blacklistModel.create
const originalUserFindById = userModel.findById
const originalUserFindOne = userModel.findOne
const originalUserCreate = userModel.create
const originalReportAggregate = reportModel.aggregate
const originalVerifyGoogleIdToken = googleAuthService.verifyGoogleIdToken

function invokeRateLimit(ip, headers = {}) {
    const result = { nextCalled: false, status: null, body: null, headers: {} }
    const response = {
        set(name, value) { result.headers[name] = value; return response },
        status(code) { result.status = code; return response },
        json(body) { result.body = body; return response }
    }
    googleAuthRateLimit({ ip, headers, socket: { remoteAddress: ip } }, response, () => { result.nextCalled = true })
    return result
}

test.beforeEach(() => {
    process.env.GOOGLE_AUTH_RATE_LIMIT_MAX = "10"
    delete process.env.GOOGLE_AUTH_RATE_LIMIT_WINDOW_MS
    delete process.env.GOOGLE_AUTH_RATE_LIMIT_MAX_CLIENTS
    resetGoogleAuthRateLimit()
    blacklistModel.findOne = async () => null
    blacklistModel.create = async document => document
    userModel.findById = async id => ({ _id: id, username: String(id), email: `${id}@example.test` })
    userModel.findOne = async () => null
    userModel.create = async () => ({ _id: "google-user", username: "Google-user", email: "google@example.test" })
    reportModel.aggregate = async () => []
    googleAuthService.verifyGoogleIdToken = async () => ({ sub: "google-sub", email: "google@example.test", name: "Google User", email_verified: true })
})

test.after(() => {
    blacklistModel.findOne = originalBlacklistFindOne
    blacklistModel.create = originalBlacklistCreate
    userModel.findById = originalUserFindById
    userModel.findOne = originalUserFindOne
    userModel.create = originalUserCreate
    reportModel.aggregate = originalReportAggregate
    googleAuthService.verifyGoogleIdToken = originalVerifyGoogleIdToken
    delete process.env.GOOGLE_AUTH_RATE_LIMIT_MAX
    delete process.env.GOOGLE_AUTH_RATE_LIMIT_WINDOW_MS
    delete process.env.GOOGLE_AUTH_RATE_LIMIT_MAX_CLIENTS
})

test("new blacklist identifiers are hashed and preserve the verified JWT expiry", () => {
    const expiresAt = getVerifiedTokenExpiry(token)
    assert.notEqual(hashToken(token), token)
    assert.match(hashToken(token), /^[a-f0-9]{64}$/)
    assert.ok(expiresAt instanceof Date)
    assert.equal(expiresAt.getTime(), jwt.decode(token).exp * 1000)
})

test("blacklist schema has an immediate TTL index for expiresAt", () => {
    const ttlIndex = blacklistModel.schema.indexes().find(([fields, options]) => fields.expiresAt === 1 && options.expireAfterSeconds === 0)
    assert.ok(ttlIndex)
})

test("legacy raw-token records and new hashed records both revoke sessions", async () => {
    const requests = []
    blacklistModel.findOne = async query => {
        requests.push(query)
        return requests.length === 1 ? { token } : { tokenHash: hashToken(token) }
    }

    const legacyResponse = await request(app)
        .get("/api/interview/")
        .set("Cookie", [`token=${token}`])
        .set("X-Expected-User-Id", "user-a")
    const hashedResponse = await request(app)
        .get("/api/interview/")
        .set("Cookie", [`token=${token}`])
        .set("X-Expected-User-Id", "user-a")

    assert.equal(legacyResponse.status, 401)
    assert.equal(hashedResponse.status, 401)
    assert.deepEqual(requests[0], { $or: [{ tokenHash: hashToken(token) }, { token }] })
})

test("logout stores only the hash and verified expiry", async () => {
    let stored
    blacklistModel.create = async document => { stored = document; return document }
    const response = await request(app)
        .post("/api/auth/logout")
        .set("Cookie", [`token=${token}`])
        .set("Origin", "http://localhost:5173")

    assert.equal(response.status, 200)
    assert.equal(stored.token, undefined)
    assert.equal(stored.tokenHash, hashToken(token))
    assert.equal(stored.expiresAt.getTime(), jwt.decode(token).exp * 1000)
})

test("logout reports persistence failure without claiming revocation", async () => {
    blacklistModel.create = async () => { throw new Error("database unavailable") }
    const response = await request(app)
        .post("/api/auth/logout")
        .set("Cookie", [`token=${token}`])
        .set("Origin", "http://localhost:5173")

    assert.equal(response.status, 503)
    assert.deepEqual(response.body, { message: "Unable to complete logout. Please try again." })
    assert.equal(response.headers["set-cookie"], undefined)
})

test("Google authentication is rate-limited without affecting other routes", async () => {
    process.env.GOOGLE_AUTH_RATE_LIMIT_MAX = "2"
    resetGoogleAuthRateLimit()
    const first = await request(app).post("/api/auth/google").send({ idToken: "valid-token" })
    const second = await request(app).post("/api/auth/google").send({ idToken: "valid-token" })
    const third = await request(app).post("/api/auth/google").send({ idToken: "valid-token" })

    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    assert.equal(third.status, 429)
    assert.equal(third.body.message, "Too many Google authentication attempts. Please try again later.")
    assert.equal((await request(app).get("/api/interview/").set("Cookie", [`token=${token}`]).set("X-Expected-User-Id", "user-a")).status, 200)
})

test("rate-limit configuration uses strict positive integers and documented defaults", () => {
    const originalMax = process.env.GOOGLE_AUTH_RATE_LIMIT_MAX
    const originalWindow = process.env.GOOGLE_AUTH_RATE_LIMIT_WINDOW_MS
    const originalMaxClients = process.env.GOOGLE_AUTH_RATE_LIMIT_MAX_CLIENTS
    delete process.env.GOOGLE_AUTH_RATE_LIMIT_MAX
    delete process.env.GOOGLE_AUTH_RATE_LIMIT_WINDOW_MS
    delete process.env.GOOGLE_AUTH_RATE_LIMIT_MAX_CLIENTS
    assert.deepEqual(getGoogleAuthRateLimitConfig(), { maxAttempts: 10, windowMs: 15 * 60 * 1000, maxClients: 10_000 })

    for (const invalid of ["", "10abc", "0", "-1", "1.5"]) {
        process.env.GOOGLE_AUTH_RATE_LIMIT_MAX = invalid
        assert.throws(() => assertGoogleAuthRateLimitConfig(), /GOOGLE_AUTH_RATE_LIMIT_MAX/)
    }

    process.env.GOOGLE_AUTH_RATE_LIMIT_MAX = "10"
    process.env.GOOGLE_AUTH_RATE_LIMIT_WINDOW_MS = "900000abc"
    assert.throws(() => assertGoogleAuthRateLimitConfig(), /GOOGLE_AUTH_RATE_LIMIT_WINDOW_MS/)

    process.env.GOOGLE_AUTH_RATE_LIMIT_WINDOW_MS = "900000"
    process.env.GOOGLE_AUTH_RATE_LIMIT_MAX_CLIENTS = "1000abc"
    assert.throws(() => assertGoogleAuthRateLimitConfig(), /GOOGLE_AUTH_RATE_LIMIT_MAX_CLIENTS/)

    if (originalMax === undefined) delete process.env.GOOGLE_AUTH_RATE_LIMIT_MAX
    else process.env.GOOGLE_AUTH_RATE_LIMIT_MAX = originalMax
    if (originalWindow === undefined) delete process.env.GOOGLE_AUTH_RATE_LIMIT_WINDOW_MS
    else process.env.GOOGLE_AUTH_RATE_LIMIT_WINDOW_MS = originalWindow
    if (originalMaxClients === undefined) delete process.env.GOOGLE_AUTH_RATE_LIMIT_MAX_CLIENTS
    else process.env.GOOGLE_AUTH_RATE_LIMIT_MAX_CLIENTS = originalMaxClients
})

test("invalid rate-limit configuration fails before server startup", () => {
    const result = spawnSync(process.execPath, ["-e", "require('./server')"], {
        cwd: path.resolve(__dirname, ".."),
        env: {
            ...process.env,
            NODE_ENV: "test",
            JWT_SECRET: "rate-limit-startup-test",
            GOOGLE_AUTH_RATE_LIMIT_MAX: "10abc"
        },
        encoding: "utf8"
    })

    assert.notEqual(result.status, 0)
    assert.match(`${result.stdout}${result.stderr}`, /Invalid GOOGLE_AUTH_RATE_LIMIT_MAX/)
})

test("expired entries are cleaned while active entries remain in their window", () => {
    process.env.GOOGLE_AUTH_RATE_LIMIT_MAX = "2"
    process.env.GOOGLE_AUTH_RATE_LIMIT_WINDOW_MS = "1000"
    resetGoogleAuthRateLimit()
    assert.equal(invokeRateLimit("expired-client").nextCalled, true)
    assert.equal(invokeRateLimit("active-client").nextCalled, true)

    const now = Date.now()
    assert.equal(cleanupExpiredRateLimitEntries(now + 500), 0)
    assert.equal(invokeRateLimit("active-client").nextCalled, true)
    assert.equal(cleanupExpiredRateLimitEntries(now + 1001), 2)
})

test("cleanup bounds memory for many unique client keys", () => {
    process.env.GOOGLE_AUTH_RATE_LIMIT_MAX = "1"
    process.env.GOOGLE_AUTH_RATE_LIMIT_WINDOW_MS = "1000"
    resetGoogleAuthRateLimit()
    for (let index = 0; index < 250; index += 1) assert.equal(invokeRateLimit(`client-${index}`).nextCalled, true)
    assert.equal(cleanupExpiredRateLimitEntries(Date.now() + 1001), 250)
})

test("rate-limit boundaries reset after the configured window", () => {
    process.env.GOOGLE_AUTH_RATE_LIMIT_MAX = "2"
    process.env.GOOGLE_AUTH_RATE_LIMIT_WINDOW_MS = "1000"
    resetGoogleAuthRateLimit()
    assert.equal(invokeRateLimit("boundary-client").nextCalled, true)
    assert.equal(invokeRateLimit("boundary-client").nextCalled, true)
    assert.equal(invokeRateLimit("boundary-client").status, 429)
    assert.equal(cleanupExpiredRateLimitEntries(Date.now() + 1001), 1)
    assert.equal(invokeRateLimit("boundary-client").nextCalled, true)
})

test("forwarded headers cannot choose a different limiter identity", () => {
    process.env.GOOGLE_AUTH_RATE_LIMIT_MAX = "1"
    process.env.GOOGLE_AUTH_RATE_LIMIT_WINDOW_MS = "1000"
    resetGoogleAuthRateLimit()
    assert.equal(invokeRateLimit("198.51.100.10", { "x-forwarded-for": "attacker-a" }).nextCalled, true)
    assert.equal(invokeRateLimit("198.51.100.10", { "x-forwarded-for": "attacker-b" }).status, 429)
})

test("capacity preserves active clients and rejects only new clients with 503", () => {
    process.env.GOOGLE_AUTH_RATE_LIMIT_MAX = "2"
    process.env.GOOGLE_AUTH_RATE_LIMIT_WINDOW_MS = "1000"
    process.env.GOOGLE_AUTH_RATE_LIMIT_MAX_CLIENTS = "2"
    resetGoogleAuthRateLimit()

    assert.equal(invokeRateLimit("capacity-a").nextCalled, true)
    assert.equal(invokeRateLimit("capacity-b").nextCalled, true)
    assert.equal(getTrackedRateLimitClientCount(), 2)

    assert.equal(invokeRateLimit("capacity-a").nextCalled, true)
    const rejected = invokeRateLimit("capacity-c")
    assert.equal(rejected.status, 503)
    assert.deepEqual(rejected.body, { message: "Google authentication is temporarily unavailable. Please try again later." })
    assert.equal(getTrackedRateLimitClientCount(), 2)

    const limited = invokeRateLimit("capacity-a")
    assert.equal(limited.status, 429)
    assert.equal(getTrackedRateLimitClientCount(), 2)
})

test("expired entries are removed before capacity is evaluated", () => {
    const originalNow = Date.now
    let now = 1000
    Date.now = () => now

    try {
        process.env.GOOGLE_AUTH_RATE_LIMIT_MAX = "2"
        process.env.GOOGLE_AUTH_RATE_LIMIT_WINDOW_MS = "100"
        process.env.GOOGLE_AUTH_RATE_LIMIT_MAX_CLIENTS = "1"
        resetGoogleAuthRateLimit()

        assert.equal(invokeRateLimit("expiring-client").nextCalled, true)
        assert.equal(invokeRateLimit("blocked-client").status, 503)
        assert.equal(getTrackedRateLimitClientCount(), 1)

        now = 1101
        assert.equal(invokeRateLimit("replacement-client").nextCalled, true)
        assert.equal(getTrackedRateLimitClientCount(), 1)
    } finally {
        Date.now = originalNow
    }
})

test("a valid JWT for a deleted user is rejected cleanly", async () => {
    userModel.findById = async () => null
    const response = await request(app).get("/api/auth/get-me").set("Cookie", [`token=${token}`])
    assert.equal(response.status, 401)
    assert.deepEqual(response.body, { message: "User session is no longer valid." })
})

test("blacklist lookup failures fail closed with a controlled response", async () => {
    blacklistModel.findOne = async () => { throw new Error("database unavailable") }
    const response = await request(app)
        .get("/api/interview/")
        .set("Cookie", [`token=${token}`])
        .set("X-Expected-User-Id", "user-a")
    assert.equal(response.status, 503)
    assert.deepEqual(response.body, { message: "Authentication service unavailable." })
})

const test = require("node:test")
const assert = require("node:assert/strict")
const mongoose = require("mongoose")
const request = require("supertest")
const { MongoMemoryServer } = require("mongodb-memory-server")

process.env.JWT_SECRET = "google-auth-test-secret-with-at-least-32-bytes"
process.env.GOOGLE_CLIENT_ID = "google-client-id"
process.env.GOOGLE_GENAI_API_KEY = "google-auth-test-key"

const app = require("../src/app")
const userModel = require("../src/models/user.model")
const reportModel = require("../src/models/interviewReport.model")
const blacklist = require("../src/models/blacklist.model")
const googleAuthService = require("../src/services/google-auth.service")
const { resetGoogleAuthRateLimit } = require("../src/middlewares/rate-limit.middleware")
const originalVerify = googleAuthService.verifyGoogleIdToken
const originalBlacklistFindOne = blacklist.findOne
let server
const identity = { sub: "google-sub-1", email: "Google.User@Example.com", email_verified: true, name: "Google User", picture: "https://example.test/avatar" }

test.before(async () => {
    server = await MongoMemoryServer.create({ instance: { dbName: `google-auth-${Date.now()}` } })
    await mongoose.connect(server.getUri())
    await userModel.init(); await reportModel.init(); blacklist.findOne = async () => null
})
test.beforeEach(async () => {
    resetGoogleAuthRateLimit()
    await userModel.deleteMany({}); await reportModel.deleteMany({})
    googleAuthService.verifyGoogleIdToken = async token => { if (token !== "valid-token") throw new Error("invalid"); return { ...identity } }
})
test.after(async () => { googleAuthService.verifyGoogleIdToken = originalVerify; await mongoose.disconnect(); await server.stop() })

test("valid Google identity creates an internal user and application session", async () => {
    const response = await request(app).post("/api/auth/google").send({ idToken: "valid-token" })
    assert.equal(response.status, 200); assert.ok(response.headers["set-cookie"].some(value => value.startsWith("token=")))
    const user = await userModel.findOne({ googleSub: identity.sub }).lean()
    assert.equal(user.email, identity.email.toLowerCase()); assert.equal(user.profilePicture, identity.picture); assert.equal(response.body.user.id, user._id.toString())
})
test("production session cookie has explicit security and lifetime attributes", async () => {
    const originalNodeEnv = process.env.NODE_ENV
    const originalCsrfOrigins = process.env.CSRF_ALLOWED_ORIGINS
    process.env.NODE_ENV = "production"
    process.env.CSRF_ALLOWED_ORIGINS = "http://localhost:5173"
    const response = await request(app).post("/api/auth/google").send({ idToken: "valid-token" })
    const cookie = response.headers["set-cookie"].find(value => value.startsWith("token="))
    assert.match(cookie, /HttpOnly/)
    assert.match(cookie, /Secure/)
    assert.match(cookie, /SameSite=Lax/)
    assert.match(cookie, /Path=\//)
    assert.match(cookie, /Max-Age=86400/)
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
    if (originalCsrfOrigins === undefined) delete process.env.CSRF_ALLOWED_ORIGINS
    else process.env.CSRF_ALLOWED_ORIGINS = originalCsrfOrigins
})
test("existing Google subject resolves to the same user and preserves report ownership", async () => {
    const user = await userModel.create({ username: "existing-google", email: identity.email, googleSub: identity.sub })
    const saved = await reportModel.create({ user: user._id, jobDescription: "Role", title: "Role", analysisVersion: "2.0" })
    const response = await request(app).post("/api/auth/google").send({ idToken: "valid-token" })
    assert.equal(response.status, 200); assert.equal(response.body.user.id, user._id.toString()); assert.equal((await reportModel.findById(saved._id)).user.toString(), user._id.toString())
})
test("invalid, expired, wrong-audience, and unverified tokens return a generic error", async () => {
    for (const token of ["invalid", "expired", "wrong-audience", "unverified"]) {
        googleAuthService.verifyGoogleIdToken = async () => { throw new Error(`${token} details`) }
        const response = await request(app).post("/api/auth/google").send({ idToken: token })
        assert.equal(response.status, 401); assert.deepEqual(response.body, { message: "Google authentication failed." })
    }
})
test("missing token is rejected before verification", async () => {
    const response = await request(app).post("/api/auth/google").send({}); assert.equal(response.status, 400); assert.deepEqual(response.body, { message: "Google authentication token is required." })
})
test("unlinked matching email is not silently merged", async () => {
    await userModel.create({ username: "existing-user", email: identity.email })
    const response = await request(app).post("/api/auth/google").send({ idToken: "valid-token" }); assert.equal(response.status, 409); assert.equal(await userModel.countDocuments({ googleSub: identity.sub }), 0)
})
test("concurrent first-time Google login creates one user", async () => {
    const responses = await Promise.all([1, 2].map(() => request(app).post("/api/auth/google").send({ idToken: "valid-token" })))
    assert.deepEqual(responses.map(item => item.status).sort(), [200, 200]); assert.equal(await userModel.countDocuments({ googleSub: identity.sub }), 1)
})
test("Google session works with protected expected-identity validation", async () => {
    const login = await request(app).post("/api/auth/google").send({ idToken: "valid-token" }); const cookie = login.headers["set-cookie"].find(value => value.startsWith("token=")).split(";")[0]; const user = await userModel.findOne({ googleSub: identity.sub })
    assert.equal((await request(app).get("/api/interview/").set("Cookie", [cookie]).set("X-Expected-User-Id", user._id.toString())).status, 200)
})
test("logout continues to revoke the application session", async () => {
    const originalNodeEnv = process.env.NODE_ENV
    const originalCsrfOrigins = process.env.CSRF_ALLOWED_ORIGINS
    process.env.NODE_ENV = "production"
    process.env.CSRF_ALLOWED_ORIGINS = "http://localhost:5173"
    const login = await request(app).post("/api/auth/google").send({ idToken: "valid-token" })
    const cookie = login.headers["set-cookie"]?.find(value => value.startsWith("token="))?.split(";")[0]
    assert.ok(cookie)

    const getLogout = await request(app).get("/api/auth/logout").set("Cookie", [cookie])
    assert.equal(getLogout.status, 404)
    const logout = await request(app).post("/api/auth/logout").set("Cookie", [cookie]).set("Origin", "http://localhost:5173")
    const clearedCookie = logout.headers["set-cookie"].find(value => value.startsWith("token="))
    assert.match(clearedCookie, /HttpOnly/)
    assert.match(clearedCookie, /Secure/)
    assert.match(clearedCookie, /SameSite=Lax/)
    assert.match(clearedCookie, /Path=\//)
    assert.match(clearedCookie, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/)

    blacklist.findOne = originalBlacklistFindOne
    const user = await userModel.findOne({ googleSub: identity.sub })
    assert.equal((await request(app).get("/api/interview/").set("Cookie", [cookie]).set("X-Expected-User-Id", user._id.toString())).status, 401)
    blacklist.findOne = async () => null
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
    if (originalCsrfOrigins === undefined) delete process.env.CSRF_ALLOWED_ORIGINS
    else process.env.CSRF_ALLOWED_ORIGINS = originalCsrfOrigins
})

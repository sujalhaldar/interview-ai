const { test, after } = require("node:test")
const assert = require("node:assert/strict")
const express = require("express")
const request = require("supertest")

process.env.JWT_SECRET = "api-security-header-test-secret"
process.env.GOOGLE_GENAI_API_KEY = "api-security-header-test-key"

const app = require("../src/app")
const apiErrorHandler = require("../src/middlewares/api-error.middleware")
const errorApp = express()
errorApp.get("/failure", () => { throw new Error("private server path and details") })
errorApp.use(apiErrorHandler)

after(() => {
    delete require.cache[require.resolve("../src/app")]
})

test("API responses include basic content and framing security headers without advertising Express", async () => {
    const response = await request(app).get("/api/missing")

    assert.equal(response.headers["x-powered-by"], undefined)
    assert.equal(response.headers["x-content-type-options"], "nosniff")
    assert.equal(response.headers["x-frame-options"], "DENY")
    assert.equal(response.headers["referrer-policy"], "no-referrer")
})

test("uncaught API errors return a sanitized JSON response in any NODE_ENV", async () => {
    const response = await request(errorApp).get("/failure")

    assert.equal(response.status, 500)
    assert.deepEqual(response.body, { message: "Internal server error." })
    assert.doesNotMatch(response.text, /private server path and details|Error:|\\\\Backend\\\\/)
})

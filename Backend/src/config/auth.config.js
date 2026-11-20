const JWT_ALGORITHM = "HS256"
const JWT_EXPIRES_IN = "1d"
const JWT_MAX_AGE_MS = 24 * 60 * 60 * 1000
const DEFAULT_FRONTEND_ORIGIN = "http://localhost:5173"

function getJwtSecret() {
    const secret = process.env.JWT_SECRET
    if (typeof secret !== "string" || !secret.trim()) {
        throw new Error("JWT_SECRET is not configured")
    }
    if (process.env.NODE_ENV === "production" && Buffer.byteLength(secret.trim(), "utf8") < 32) {
        throw new Error("JWT_SECRET must contain at least 32 bytes in production")
    }
    return secret
}

function assertJwtSecretConfigured() {
    getJwtSecret()
}

function getSessionCookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        path: "/",
        maxAge: JWT_MAX_AGE_MS
    }
}

function getSessionCookieClearOptions() {
    const { httpOnly, secure, sameSite, path } = getSessionCookieOptions()
    return { httpOnly, secure, sameSite, path }
}

function getAllowedCsrfOrigins() {
    const rawConfigured = process.env.CSRF_ALLOWED_ORIGINS
    if (rawConfigured === undefined) {
        return process.env.NODE_ENV === "production" ? [] : [DEFAULT_FRONTEND_ORIGIN]
    }
    if (!rawConfigured.trim()) throw new Error("Invalid CSRF_ALLOWED_ORIGINS entry: empty origin")

    return rawConfigured.split(",").map(value => normalizeOrigin(value, "configuration"))
}

function assertCsrfOriginsConfigured() {
    const origins = getAllowedCsrfOrigins()
    if (process.env.NODE_ENV === "production" && origins.length === 0) {
        throw new Error("CSRF_ALLOWED_ORIGINS is not configured")
    }
}

function normalizeOrigin(value, source = "request") {
    const label = source === "configuration" ? "CSRF_ALLOWED_ORIGINS entry" : "request origin"
    const fail = category => {
        throw new Error(`Invalid ${label}: ${category}`)
    }

    if (typeof value !== "string" || !value.trim()) fail("empty origin")
    const candidate = value.trim()
    if (candidate.toLowerCase() === "null") fail("literal null")
    if (candidate.includes("*")) fail("wildcard")

    const schemeSeparator = candidate.indexOf("://")
    if (schemeSeparator !== -1) {
        const authorityAndSuffix = candidate.slice(schemeSeparator + 3)
        const delimiterIndex = authorityAndSuffix.search(/[/?#\\]/)
        if (delimiterIndex !== -1) {
            const suffix = authorityAndSuffix.slice(delimiterIndex)
            if (suffix === "/") {
                // A single trailing slash is equivalent to the origin.
            } else if (suffix.startsWith("?") || suffix.startsWith("/?")) {
                fail("query string is not allowed")
            } else if (suffix.startsWith("#") || suffix.startsWith("/#")) {
                fail("fragment is not allowed")
            } else {
                fail("path is not allowed")
            }
        }
    }

    let parsed
    try {
        parsed = new URL(candidate)
    } catch {
        fail("malformed URL")
    }

    if (!parsed || !["http:", "https:"].includes(parsed.protocol)) fail("scheme must be HTTP/HTTPS")
    if (parsed.username || parsed.password) fail("embedded credentials")
    if (parsed.pathname !== "/") fail("path is not allowed")
    if (parsed.search) fail("query string is not allowed")
    if (parsed.hash) fail("fragment is not allowed")

    return parsed.origin
}

module.exports = {
    JWT_ALGORITHM,
    JWT_EXPIRES_IN,
    JWT_MAX_AGE_MS,
    getJwtSecret,
    assertJwtSecretConfigured,
    getSessionCookieOptions,
    getSessionCookieClearOptions,
    getAllowedCsrfOrigins,
    assertCsrfOriginsConfigured,
    normalizeOrigin
}

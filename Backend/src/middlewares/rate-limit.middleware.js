const DEFAULT_MAX_ATTEMPTS = 10
const DEFAULT_WINDOW_MS = 15 * 60 * 1000
// Per-process memory bound; tune this to the instance's expected authentication concurrency.
const DEFAULT_MAX_CLIENTS = 10_000
const CLEANUP_INTERVAL_MS = 60 * 1000
const attemptsByClient = new Map()
let nextCleanupAt = 0

function configuredPositiveInteger(name, fallback) {
    const configuredValue = process.env[name]
    if (configuredValue === undefined) return fallback

    const value = configuredValue.trim()
    if (!/^\d+$/.test(value)) {
        throw new Error(`Invalid ${name}: expected a positive integer`)
    }

    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid ${name}: expected a positive integer`)
    }

    return parsed
}

function getGoogleAuthRateLimitConfig() {
    return {
        maxAttempts: configuredPositiveInteger("GOOGLE_AUTH_RATE_LIMIT_MAX", DEFAULT_MAX_ATTEMPTS),
        windowMs: configuredPositiveInteger("GOOGLE_AUTH_RATE_LIMIT_WINDOW_MS", DEFAULT_WINDOW_MS),
        maxClients: configuredPositiveInteger("GOOGLE_AUTH_RATE_LIMIT_MAX_CLIENTS", DEFAULT_MAX_CLIENTS)
    }
}

function assertGoogleAuthRateLimitConfig() {
    getGoogleAuthRateLimitConfig()
}

function cleanupExpiredRateLimitEntries(now = Date.now()) {
    let removed = 0
    for (const [clientKey, entry] of attemptsByClient) {
        if (entry.resetAt <= now) {
            attemptsByClient.delete(clientKey)
            removed += 1
        }
    }
    return removed
}

function maybeCleanupExpiredRateLimitEntries(now) {
    if (now >= nextCleanupAt) {
        cleanupExpiredRateLimitEntries(now)
        nextCleanupAt = now + CLEANUP_INTERVAL_MS
    }
}

function cleanupBeforeCapacityCheck(now) {
    cleanupExpiredRateLimitEntries(now)
    nextCleanupAt = now + CLEANUP_INTERVAL_MS
}

function googleAuthRateLimit(req, res, next) {
    const { maxAttempts, windowMs, maxClients } = getGoogleAuthRateLimitConfig()
    const now = Date.now()
    maybeCleanupExpiredRateLimitEntries(now)
    // req.ip is derived from the socket unless Express is explicitly configured to trust a proxy.
    // Never read the raw X-Forwarded-For header here; configure trusted proxy hops before production use.
    const clientKey = req.ip || req.socket?.remoteAddress || "unknown"
    const existing = attemptsByClient.get(clientKey)

    if (!existing && attemptsByClient.size >= maxClients) {
        cleanupBeforeCapacityCheck(now)
        if (attemptsByClient.size >= maxClients) {
            let earliestResetAt = Infinity
            for (const entry of attemptsByClient.values()) {
                if (entry.resetAt < earliestResetAt) earliestResetAt = entry.resetAt
            }
            if (Number.isFinite(earliestResetAt) && earliestResetAt > now) {
                res.set("Retry-After", String(Math.max(1, Math.ceil((earliestResetAt - now) / 1000))))
            }
            return res.status(503).json({ message: "Google authentication is temporarily unavailable. Please try again later." })
        }
    }

    const entry = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + windowMs }

    if (entry.count >= maxAttempts) {
        res.set("Retry-After", String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))))
        return res.status(429).json({ message: "Too many Google authentication attempts. Please try again later." })
    }

    entry.count += 1
    attemptsByClient.set(clientKey, entry)
    next()
}

function resetGoogleAuthRateLimit() {
    attemptsByClient.clear()
    nextCleanupAt = 0
}

module.exports = {
    googleAuthRateLimit,
    resetGoogleAuthRateLimit,
    cleanupExpiredRateLimitEntries,
    getGoogleAuthRateLimitConfig,
    assertGoogleAuthRateLimitConfig,
    getTrackedRateLimitClientCount: () => attemptsByClient.size
}

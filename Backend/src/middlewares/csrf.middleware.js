const { getAllowedCsrfOrigins, normalizeOrigin } = require("../config/auth.config")

function requestOrigin(req) {
    const origin = req.get("Origin")
    if (origin !== undefined) {
        if (origin.trim().toLowerCase() === "null") return null
        try {
            return normalizeOrigin(origin)
        } catch {
            return null
        }
    }

    const referer = req.get("Referer")
    if (!referer) return null

    try {
        const parsed = new URL(referer)
        if (parsed.username || parsed.password) return null
        return normalizeOrigin(parsed.origin)
    } catch {
        return null
    }
}

function csrfOrigin(req, res, next) {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next()

    const origin = requestOrigin(req)
    if (!origin || !getAllowedCsrfOrigins().includes(origin)) {
        return res.status(403).json({ message: "CSRF validation failed." })
    }

    next()
}

module.exports = { csrfOrigin }

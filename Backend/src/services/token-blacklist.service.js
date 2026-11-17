const crypto = require("crypto")
const jwt = require("jsonwebtoken")
const { JWT_ALGORITHM, getJwtSecret } = require("../config/auth.config")

function hashToken(token) {
    return crypto.createHash("sha256").update(token, "utf8").digest("hex")
}

function getVerifiedTokenExpiry(token) {
    try {
        const decoded = jwt.verify(token, getJwtSecret(), { algorithms: [JWT_ALGORITHM] })
        if (!Number.isFinite(decoded.exp)) return null
        const expiresAt = new Date(decoded.exp * 1000)
        return Number.isNaN(expiresAt.getTime()) ? null : expiresAt
    } catch {
        return null
    }
}

module.exports = { hashToken, getVerifiedTokenExpiry }

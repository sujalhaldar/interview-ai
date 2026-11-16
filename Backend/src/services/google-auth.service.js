const { OAuth2Client } = require("google-auth-library")

const client = new OAuth2Client()

async function verifyGoogleIdToken(idToken) {
    if (typeof idToken !== "string" || !idToken.trim() || !process.env.GOOGLE_CLIENT_ID) {
        throw new Error("Invalid Google authentication request")
    }

    const ticket = await client.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID
    })
    const payload = ticket.getPayload()
    if (!payload || !payload.sub || !payload.email || payload.email_verified !== true || !["accounts.google.com", "https://accounts.google.com"].includes(payload.iss)) {
        throw new Error("Invalid Google identity")
    }
    return payload
}

module.exports = { verifyGoogleIdToken }

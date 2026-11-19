require("dotenv").config()
const { assertCsrfOriginsConfigured, assertJwtSecretConfigured } = require("./src/config/auth.config")
const { assertGoogleAuthRateLimitConfig } = require("./src/middlewares/rate-limit.middleware")

assertJwtSecretConfigured()
assertCsrfOriginsConfigured()
assertGoogleAuthRateLimitConfig()
const app = require("./src/app")
const connectToDB = require("./src/config/database")

function resolvePort(value = process.env.PORT) {
    if (value === undefined) return 3000

    if (typeof value !== "string" || !/^\d+$/.test(value)) {
        throw new Error("Invalid PORT: expected an integer TCP port from 1 to 65535")
    }

    const port = Number(value)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("Invalid PORT: expected an integer TCP port from 1 to 65535")
    }

    return port
}

async function startServer({ connect = connectToDB, listen } = {}) {
    const port = resolvePort()
    const startListening = listen || (() => app.listen(port, () => {
        console.log(`Server is running on port ${port}`)
    }))
    await connect()
    return startListening(port)
}

if (require.main === module) {
    startServer().catch(error => {
        console.error(`Server startup failed: ${error.message}`)
        process.exitCode = 1
    })
}

module.exports = { resolvePort, startServer }

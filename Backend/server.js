require("dotenv").config()
const { assertCsrfOriginsConfigured, assertJwtSecretConfigured } = require("./src/config/auth.config")
const { assertGoogleAuthRateLimitConfig } = require("./src/middlewares/rate-limit.middleware")

assertJwtSecretConfigured()
assertCsrfOriginsConfigured()
assertGoogleAuthRateLimitConfig()
const app = require("./src/app")
const connectToDB = require("./src/config/database")

async function startServer({ connect = connectToDB, listen = () => app.listen(3000, () => {
    console.log("Server is running on port 3000")
}) } = {}) {
    await connect()
    return listen()
}

if (require.main === module) {
    startServer().catch(error => {
        console.error(`Server startup failed: ${error.message}`)
        process.exitCode = 1
    })
}

module.exports = { startServer }

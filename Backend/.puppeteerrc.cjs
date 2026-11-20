const { join } = require("node:path")

// Render's home cache is not part of the deployed build artifact.
module.exports = process.env.RENDER === "true"
    ? { cacheDirectory: join(__dirname, ".cache", "puppeteer") }
    : {}

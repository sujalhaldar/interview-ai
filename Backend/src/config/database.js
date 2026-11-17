const mongoose = require("mongoose")
const blacklistModel = require("../models/blacklist.model")

const BLACKLIST_TTL_INDEX_ERROR = "Blacklist TTL index verification failed"
const BLACKLIST_TTL_INDEX_INITIALIZATION_ERROR = "Blacklist TTL index initialization failed"

function isExpectedBlacklistTtlIndex(index) {
    const keys = Object.keys(index?.key || {})
    return keys.length === 1 && index.key.expiresAt === 1 && index.expireAfterSeconds === 0
}

function verifyBlacklistTtlIndexDefinition(indexes) {
    const expiryIndexes = indexes.filter(index => Object.prototype.hasOwnProperty.call(index.key || {}, "expiresAt"))
    if (expiryIndexes.length !== 1 || !isExpectedBlacklistTtlIndex(expiryIndexes[0])) {
        const error = new Error(BLACKLIST_TTL_INDEX_ERROR)
        error.code = "BLACKLIST_TTL_INDEX_INVALID"
        throw error
    }
    return expiryIndexes[0]
}

async function verifyBlacklistTtlIndex() {
    const indexes = await blacklistModel.collection.listIndexes().toArray()
    return verifyBlacklistTtlIndexDefinition(indexes)
}

async function initializeBlacklistTtlIndex() {
    try {
        await blacklistModel.init()
        return await verifyBlacklistTtlIndex()
    }
    catch (err) {
        if (err?.code === "BLACKLIST_TTL_INDEX_INVALID") throw err
        const error = new Error(BLACKLIST_TTL_INDEX_INITIALIZATION_ERROR)
        error.code = "BLACKLIST_TTL_INDEX_INITIALIZATION_FAILED"
        throw error
    }
}

async function connectToDB() {

    try {
        await mongoose.connect(process.env.MONGO_URI)
        await initializeBlacklistTtlIndex()

        console.log("Connected to Database")
        return mongoose.connection
    }
    catch (err) {
        await mongoose.disconnect().catch(() => {})
        if (err?.code === "BLACKLIST_TTL_INDEX_INVALID" || err?.code === "BLACKLIST_TTL_INDEX_INITIALIZATION_FAILED") throw err
        throw new Error("Database startup initialization failed")
    }
}

module.exports = connectToDB
module.exports.initializeBlacklistTtlIndex = initializeBlacklistTtlIndex
module.exports.verifyBlacklistTtlIndex = verifyBlacklistTtlIndex
module.exports.verifyBlacklistTtlIndexDefinition = verifyBlacklistTtlIndexDefinition

const test = require("node:test")
const assert = require("node:assert/strict")

process.env.JWT_SECRET = "database-startup-test-secret"
process.env.GOOGLE_GENAI_API_KEY = "database-startup-test-key"

const mongoose = require("mongoose")
const blacklistModel = require("../src/models/blacklist.model")
const database = require("../src/config/database")
const { resolvePort, startServer } = require("../server")

const originalConnect = mongoose.connect
const originalDisconnect = mongoose.disconnect
const originalBlacklistInit = blacklistModel.init
const originalListIndexes = blacklistModel.collection.listIndexes

function expectedTtlIndex() {
    return { name: "expiresAt_1", key: { expiresAt: 1 }, expireAfterSeconds: 0 }
}

function configureDatabaseMocks({ indexes = [expectedTtlIndex()], events = [] } = {}) {
    mongoose.connect = async () => { events.push("connect") }
    mongoose.disconnect = async () => { events.push("disconnect") }
    blacklistModel.init = async () => { events.push("init") }
    blacklistModel.collection.listIndexes = () => ({ toArray: async () => { events.push("verify"); return indexes } })
}

test.after(() => {
    mongoose.connect = originalConnect
    mongoose.disconnect = originalDisconnect
    blacklistModel.init = originalBlacklistInit
    blacklistModel.collection.listIndexes = originalListIndexes
})

test("server uses port 3000 when PORT is not configured", () => {
    const originalPort = process.env.PORT
    try {
        delete process.env.PORT
        assert.equal(resolvePort(), 3000)
    } finally {
        if (originalPort === undefined) delete process.env.PORT
        else process.env.PORT = originalPort
    }
})

test("server uses the configured PORT", () => {
    const originalPort = process.env.PORT
    try {
        process.env.PORT = "8080"
        assert.equal(resolvePort(), 8080)
    } finally {
        if (originalPort === undefined) delete process.env.PORT
        else process.env.PORT = originalPort
    }
})

test("server rejects invalid configured PORT values", () => {
    for (const port of ["3000abc", "65536", "0", "-1", "3000.5", ""]) {
        assert.throws(() => resolvePort(port), /Invalid PORT/)
    }
})

test("production start script launches the server entry point", () => {
    const packageJson = require("../package.json")
    assert.equal(packageJson.scripts.start, "node server.js")
})

test("database startup connects before initializing and verifying the blacklist TTL index", async () => {
    const events = []
    configureDatabaseMocks({ events })

    await database()

    assert.deepEqual(events, ["connect", "init", "verify"])
})

test("blacklist TTL index verification rejects an incorrect expiration configuration", async () => {
    configureDatabaseMocks({ indexes: [{ name: "expiresAt_1", key: { expiresAt: 1 }, expireAfterSeconds: 60 }] })

    await assert.rejects(database(), /Blacklist TTL index verification failed/)
})

test("blacklist TTL index initialization failures stop startup", async () => {
    mongoose.connect = async () => {}
    mongoose.disconnect = async () => {}
    blacklistModel.init = async () => { throw new Error("index creation failed") }

    await assert.rejects(database(), /Blacklist TTL index initialization failed/)
})

test("repeated blacklist index initialization is safe", async () => {
    const events = []
    configureDatabaseMocks({ events })

    await database.initializeBlacklistTtlIndex()
    await database.initializeBlacklistTtlIndex()

    assert.deepEqual(events, ["init", "verify", "init", "verify"])
})

test("server startup waits for database readiness before listening", async () => {
    const events = []
    let resolveDatabase
    const databaseReady = new Promise(resolve => { resolveDatabase = resolve })

    const startup = startServer({
        connect: async () => {
            events.push("connect-start")
            await databaseReady
            events.push("database-ready")
        },
        listen: port => { events.push(["listen", port]) }
    })

    await Promise.resolve()
    assert.deepEqual(events, ["connect-start"])

    resolveDatabase()
    await startup
    assert.deepEqual(events, ["connect-start", "database-ready", ["listen", 3000]])
})

test("server passes a custom port to listen after database initialization", async () => {
    const originalPort = process.env.PORT
    const events = []
    try {
        process.env.PORT = "8080"
        await startServer({
            connect: async () => { events.push("database-ready") },
            listen: port => { events.push(["listen", port]) }
        })
        assert.deepEqual(events, ["database-ready", ["listen", 8080]])
    } finally {
        if (originalPort === undefined) delete process.env.PORT
        else process.env.PORT = originalPort
    }
})

test("invalid PORT fails before connecting or listening", async () => {
    const originalPort = process.env.PORT
    const events = []
    try {
        process.env.PORT = "3000abc"
        await assert.rejects(
            startServer({
                connect: async () => { events.push("connect") },
                listen: () => { events.push("listen") }
            }),
            /Invalid PORT/
        )
        assert.deepEqual(events, [])
    } finally {
        if (originalPort === undefined) delete process.env.PORT
        else process.env.PORT = originalPort
    }
})

test("server startup rejects connection failures without listening", async () => {
    const events = []

    await assert.rejects(
        startServer({
            connect: async () => { throw new Error("database unavailable") },
            listen: () => { events.push("listen") }
        }),
        /database unavailable/
    )

    assert.deepEqual(events, [])
})

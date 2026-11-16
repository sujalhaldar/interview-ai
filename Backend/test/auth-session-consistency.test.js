const { test, beforeEach, afterEach, after } = require('node:test')
const assert = require('node:assert/strict')
const jwt = require('jsonwebtoken')
const request = require('supertest')

const TEST_JWT_SECRET = 'auth-session-consistency-test-secret'
process.env.JWT_SECRET = TEST_JWT_SECRET
process.env.GOOGLE_GENAI_API_KEY = 'auth-session-consistency-test-key'
const tokenBlacklistModel = require('../src/models/blacklist.model')
const userModel = require('../src/models/user.model')
const interviewReportModel = require('../src/models/interviewReport.model')
const app = require('../src/app')
const originalBlacklistFindOne = tokenBlacklistModel.findOne
const originalUserFindById = userModel.findById
const originalAggregate = interviewReportModel.aggregate

const tokenFor = id => jwt.sign({ id, username: id }, TEST_JWT_SECRET)

beforeEach(() => {
    tokenBlacklistModel.findOne = async () => null
    userModel.findById = async id => ({ _id: id, username: id, email: `${id}@example.test` })
    interviewReportModel.aggregate = async () => []
})

afterEach(() => {
    tokenBlacklistModel.findOne = originalBlacklistFindOne
    userModel.findById = originalUserFindById
    interviewReportModel.aggregate = originalAggregate
})

test('rejects a request when expected identity differs from the verified JWT', async () => {
    const response = await request(app)
        .get('/api/interview/')
        .set('Cookie', [`token=${tokenFor('user-b')}`])
        .set('X-Expected-User-Id', 'user-a')

    assert.equal(response.status, 409)
    assert.equal(response.body.message, 'Authentication session changed. Please retry.')
})

test('allows a request when expected identity matches the verified JWT', async () => {
    const response = await request(app)
        .get('/api/interview/')
        .set('Cookie', [`token=${tokenFor('user-a')}`])
        .set('X-Expected-User-Id', 'user-a')

    assert.equal(response.status, 200)
    assert.deepEqual(response.body.interviewReports, [])
})

for (const [name, header] of [['missing', undefined], ['empty', ''], ['malformed', 'not a valid id']]) {
    test(`rejects ${name} expected identity headers`, async () => {
        const req = request(app).get('/api/interview/').set('Cookie', [`token=${tokenFor('user-a')}`])
        if (header !== undefined) req.set('X-Expected-User-Id', header)
        const response = await req
        assert.equal(response.status, 409)
    })
}

after(() => {
    delete require.cache[require.resolve('../src/app')]
})

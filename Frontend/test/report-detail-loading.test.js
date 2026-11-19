import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isReportIdentityReady, runReportDetailRequest, reportLoadErrorKind } from '../src/features/interview/report-detail.lifecycle.js'

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8')
const interviewHook = read('../src/features/interview/hooks/useInterview.js')
const interviewContext = read('../src/features/interview/interview.context.jsx')
const interviewPage = read('../src/features/interview/pages/Interview.jsx')

const deferred = () => {
    let resolve
    let reject
    const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
    return { promise, resolve, reject }
}

test('direct report loading waits for authentication and provider identity initialization', async () => {
    const auth = deferred()
    let authLoading = true
    let userId = null
    let readyUserId = null
    const requested = []
    const requestWhenReady = () => {
        if (isReportIdentityReady({ authLoading, userId, readyUserId })) requested.push('report-1')
    }

    requestWhenReady()
    authLoading = false
    auth.resolve('user-a')
    userId = await auth.promise
    requestWhenReady()
    assert.deepEqual(requested, [])

    readyUserId = userId
    requestWhenReady()
    assert.deepEqual(requested, ['report-1'])
})

test('a provider identity transition invalidates a pending detail success and allows the current identity request to settle', async () => {
    const pendingReport = deferred()
    let identity = { userId: 'user-a', generation: 1 }
    let requestGeneration = 1
    const updates = []
    const staleRequest = runReportDetailRequest({
        load: () => pendingReport.promise,
        markOpened: async () => updates.push('stale-opened'),
        isCurrent: () => requestGeneration === 1 && identity.userId === 'user-a' && identity.generation === 1,
        onSuccess: value => updates.push(value),
        onError: value => updates.push(value),
        onSettled: () => updates.push('stale-settled'),
    })

    identity = { userId: 'user-b', generation: 2 }
    requestGeneration = 2
    pendingReport.resolve({ id: 'report-a' })
    await staleRequest
    assert.deepEqual(updates, [])

    let currentLoading = true
    await runReportDetailRequest({
        load: async () => ({ id: 'report-b' }),
        markOpened: async () => undefined,
        isCurrent: () => requestGeneration === 2 && identity.userId === 'user-b' && identity.generation === 2,
        onSuccess: value => updates.push(value),
        onError: value => updates.push(value),
        onSettled: () => { currentLoading = false },
    })
    assert.deepEqual(updates, [{ id: 'report-b' }])
    assert.equal(currentLoading, false)
})

test('a stale request failure cannot replace the current report error state', async () => {
    const pendingFailure = deferred()
    let current = true
    const errors = []
    const request = runReportDetailRequest({
        load: () => pendingFailure.promise,
        markOpened: async () => undefined,
        isCurrent: () => current,
        onSuccess: () => assert.fail('stale failure must not succeed'),
        onError: error => errors.push(error),
        onSettled: () => undefined,
    })

    current = false
    pendingFailure.reject({ response: { status: 404 } })
    await request
    assert.deepEqual(errors, [])
})

test('a route change supersedes an older report response', async () => {
    const oldResponse = deferred()
    let activeGeneration = 1
    let displayedReport = null
    const oldRequest = runReportDetailRequest({
        load: () => oldResponse.promise,
        markOpened: async () => undefined,
        isCurrent: () => activeGeneration === 1,
        onSuccess: value => { displayedReport = value },
        onError: () => undefined,
        onSettled: () => undefined,
    })

    activeGeneration = 2
    await runReportDetailRequest({
        load: async () => ({ id: 'new-route-report' }),
        markOpened: async () => undefined,
        isCurrent: () => activeGeneration === 2,
        onSuccess: value => { displayedReport = value },
        onError: () => undefined,
        onSettled: () => undefined,
    })
    oldResponse.resolve({ id: 'old-route-report' })
    await oldRequest
    assert.deepEqual(displayedReport, { id: 'new-route-report' })
})

test('current failures settle loading and map 401, 404, and server/network failures to safe states', async () => {
    const errors = []
    let settled = 0
    for (const error of [{ response: { status: 401 } }, { response: { status: 404 } }, { response: { status: 503, data: { message: 'private detail' } } }, { code: 'ERR_NETWORK' }]) {
        await runReportDetailRequest({
            load: async () => { throw error },
            markOpened: async () => undefined,
            isCurrent: () => true,
            onSuccess: () => assert.fail('failed requests must not succeed'),
            onError: kind => errors.push(kind),
            onSettled: () => { settled += 1 },
        })
    }
    assert.deepEqual(errors, ['unauthorized', 'not-found', 'unavailable', 'unavailable'])
    assert.equal(settled, 4)
})

test('an empty successful response becomes not-found instead of leaving the page loading', async () => {
    const states = []
    let loading = true
    await runReportDetailRequest({
        load: async () => null,
        markOpened: async () => undefined,
        isCurrent: () => true,
        onSuccess: () => assert.fail('an empty report must not render as success'),
        onError: kind => states.push(kind),
        onSettled: () => { loading = false },
    })
    assert.deepEqual(states, ['not-found'])
    assert.equal(loading, false)
})

test('report loading settles without waiting for the best-effort opened marker', async () => {
    const marker = deferred()
    let loading = true
    await runReportDetailRequest({
        load: async () => ({ id: 'report-1' }),
        markOpened: () => marker.promise,
        isCurrent: () => true,
        onSuccess: () => undefined,
        onError: () => undefined,
        onSettled: () => { loading = false },
    })
    assert.equal(loading, false)
    marker.resolve()
})

test('a missing or expired report is rendered separately from the initial loading state with retry where useful', () => {
    assert.match(interviewPage, /reportError === 'not-found'/)
    assert.match(interviewPage, /reportError === 'unauthorized'/)
    assert.match(interviewPage, /Retry loading report/)
    assert.match(interviewPage, /role='alert'/)
})

test('report fetching waits for identity readiness, supersedes route requests, and catches route-triggered failures', () => {
    assert.match(interviewHook, /if \(!identityReady \|\| !requestIdentity\.userId\) return Promise\.resolve\(null\)/)
    assert.match(interviewHook, /detailRequestGeneration\.current/)
    assert.match(interviewHook, /const requestKey = `\$\{interviewId\}:\$\{requestIdentity\.userId\}:\$\{requestIdentity\.sessionGeneration\}`/)
    assert.match(interviewHook, /activeDetailRequest\.current\?\.key === requestKey/)
    assert.match(interviewHook, /void getReportById\(interviewId\)/)
    assert.match(interviewContext, /identityReady/)
    assert.match(interviewContext, /authLoading/)
})

test('report detail loading remains separate from report history refresh state', () => {
    assert.match(interviewContext, /setReports\(response\.interviewReports\)/)
    assert.match(interviewContext, /setReportLoading\(false\)/)
    assert.match(interviewContext, /setReportsError\(status === 401 \? 'Your session has expired/)
    assert.match(interviewHook, /refreshReports\(\{ silent: true \}\)/)
})

test('direct route and browser history remain route-parameter driven', () => {
    const routes = read('../src/app.routes.jsx')
    assert.match(routes, /path:"\/interview\/:interviewId"/)
    assert.match(interviewHook, /const \{ interviewId \} = useParams\(\)/)
    assert.match(interviewHook, /\[ interviewId, identityReady, sessionGeneration, getReportById, setReport, setReportError, setReportLoading \]/)
})

test('report errors never expose backend response text', async () => {
    let message
    await runReportDetailRequest({
        load: async () => { throw { response: { status: 500, data: { message: 'private backend details' } } } },
        markOpened: async () => undefined,
        isCurrent: () => true,
        onSuccess: () => undefined,
        onError: kind => { message = kind },
        onSettled: () => undefined,
    })
    assert.equal(message, reportLoadErrorKind({ response: { status: 500, data: { message: 'private backend details' } } }))
    assert.doesNotMatch(String(message), /private backend details/)
})

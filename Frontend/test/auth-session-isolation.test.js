import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8')
const authHook = read('../src/features/auth/hooks/useAuth.js')
const loginPage = read('../src/features/auth/pages/Login.jsx')
const interviewContext = read('../src/features/interview/interview.context.jsx')
const interviewHook = read('../src/features/interview/hooks/useInterview.js')
const homePage = read('../src/features/interview/pages/Home.jsx')

test('Google authentication remains the only login UI and reports errors', () => {
    assert.doesNotMatch(loginPage, /type="password"|handleLogin|\/register/)
    assert.match(loginPage, /google\.accounts\.id\.initialize/)
    assert.match(loginPage, /role='alert'/)
    assert.match(authHook, /return \{ success: false, error: err \}/)
})

test('identity transitions clear user-scoped interview state', () => {
    assert.match(interviewContext, /setReports\(\[\]\)/)
    assert.match(interviewContext, /setReport\(null\)/)
    assert.match(interviewContext, /setReportsError\(''\)/)
    assert.match(interviewContext, /setAnalysisProgress\(null\)/)
    assert.match(interviewContext, /user\?\.id/)
})

test('cross-tab identity signals invalidate before current-user resolution', () => {
    assert.match(authHook, /announcedUserId\) \{ setExpectedUserId\(null\); setUser\(null\) \}/)
    assert.match(authHook, /resolveCurrentUser\(generation\)/)
    assert.match(authHook, /window\.addEventListener\('storage'/)
    assert.match(authHook, /setExpectedUserId\(null\); setUser\(null\)/)
})

test('history and detail responses require the captured identity and generation', () => {
    assert.match(interviewHook, /const detailRequestGeneration = useRef\(0\)/)
    assert.match(interviewHook, /const requestIdentity = identityRef\.current/)
    assert.match(interviewHook, /currentIdentity\.userId === requestIdentity\.userId/)
    assert.match(interviewHook, /currentIdentity\.sessionGeneration === requestIdentity\.sessionGeneration/)
    assert.match(interviewHook, /historyRequestGeneration\.current \+= 1/)
})

test('protected interview requests carry the expected identity header', () => {
    const api = read('../src/features/interview/services/interview.api.js')
    assert.match(api, /X-Expected-User-Id/)
    assert.match(api, /Authentication session is changing/)
})

test('stale errors and loading callbacks are guarded like stale successes', () => {
    assert.match(interviewHook, /if \(requestGeneration === detailRequestGeneration\.current.*setReport\(null\)/s)
    assert.match(interviewHook, /if \(requestGeneration === historyRequestGeneration\.current.*setReportsError/s)
    assert.match(interviewHook, /identityRef\.current\.sessionGeneration === requestIdentity\.sessionGeneration.*setLoading\(false\)/s)
})

test('history loading is separate from explicit analysis progress loading', () => {
    assert.match(interviewContext, /const \[analysisLoading, setAnalysisLoading\] = useState\(false\)/)
    assert.match(interviewContext, /const \[historyLoading, setHistoryLoading\] = useState\(false\)/)
    assert.match(interviewHook, /setAnalysisLoading\(true\)/)
    assert.match(interviewHook, /setAnalysisLoading\(false\)/)
    assert.match(homePage, /if \(analysisLoading\)/)
    assert.match(homePage, /disabled=\{analysisLoading\}/)
    assert.match(homePage, /Loading recent analyses/)
})

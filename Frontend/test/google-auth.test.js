import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const api = fs.readFileSync(new URL('../src/features/auth/services/auth.api.js', import.meta.url), 'utf8')
const auth = fs.readFileSync(new URL('../src/features/auth/hooks/useAuth.js', import.meta.url), 'utf8')
const login = fs.readFileSync(new URL('../src/features/auth/pages/Login.jsx', import.meta.url), 'utf8')
const home = fs.readFileSync(new URL('../src/features/interview/pages/Home.jsx', import.meta.url), 'utf8')

test('Google auth posts the GIS credential to the backend endpoint', () => {
    assert.match(api, /post\("\/api\/auth\/google", \{ idToken \}\)/)
    assert.match(login, /response\?\.credential/)
})

test('Google button waits for the loading screen to mount its container', () => {
    assert.match(login, /if \(!googleClientId \|\| loading\) return undefined/)
    assert.match(login, /googleButtonRef\.current/)
    assert.match(login, /google\.accounts\.id\.renderButton/)
})

test('Google auth prevents duplicate callbacks and cleans loading state', () => {
    assert.match(auth, /googleLoginInFlight\.current/)
    assert.match(auth, /if \(isCurrentTransition\(generation\)\) setLoading\(false\)/)
    assert.match(login, /googleInitializedRef\.current/)
})

test('Google auth does not persist provider or application tokens', () => {
    assert.doesNotMatch(login, /localStorage|sessionStorage/)
    assert.match(login, /google\.accounts\.id\.initialize/)
})

test('authenticated homepage exposes guarded logout navigation', () => {
    assert.match(home, /handleLogout/)
    assert.match(home, /navigate\('\/login', \{ replace: true \}\)/)
    assert.match(home, /if \(logoutPending\) return/)
})

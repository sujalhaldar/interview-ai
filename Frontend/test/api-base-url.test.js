import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { API_BASE_URL, normalizeApiBaseUrl, resolveApiBaseUrl } from '../src/config/api.js'

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8')
const frontendRoot = fileURLToPath(new URL('..', import.meta.url))
const authApi = read('../src/features/auth/services/auth.api.js')
const interviewApi = read('../src/features/interview/services/interview.api.js')

test('uses the local backend fallback when no API base URL is configured', () => {
    assert.equal(normalizeApiBaseUrl(undefined), 'http://localhost:3000')
    assert.equal(normalizeApiBaseUrl(''), 'http://localhost:3000')
})

test('uses a configured API base URL without trailing slashes', () => {
    assert.equal(normalizeApiBaseUrl('https://api.example.test///'), 'https://api.example.test')
    assert.equal(normalizeApiBaseUrl('  https://api.example.test/  '), 'https://api.example.test')
})

test('resolves the exported API base URL from a configured Vite environment', async () => {
    const originalValue = process.env.VITE_API_BASE_URL
    process.env.VITE_API_BASE_URL = 'https://api.example.test///'
    let vite

    try {
        vite = await createServer({
            configFile: false,
            root: frontendRoot,
            logLevel: 'silent',
            server: { middlewareMode: true }
        })
        const apiConfig = await vite.ssrLoadModule('/src/config/api.js')
        assert.equal(apiConfig.API_BASE_URL, 'https://api.example.test')
    } finally {
        if (vite) await vite.close()
        if (originalValue === undefined) delete process.env.VITE_API_BASE_URL
        else process.env.VITE_API_BASE_URL = originalValue
    }

    assert.equal(resolveApiBaseUrl({ VITE_API_BASE_URL: 'https://api.example.test///' }), 'https://api.example.test')
})

test('both API clients and streaming fetch use the centralized base URL', () => {
    assert.match(authApi, /import \{ API_BASE_URL \} from ['"]\.\.\/\.\.\/\.\.\/config\/api\.js['"]/)
    assert.match(authApi, /baseURL: API_BASE_URL/)
    assert.match(interviewApi, /import \{ API_BASE_URL \} from ['"]\.\.\/\.\.\/\.\.\/config\/api\.js['"]/)
    assert.match(interviewApi, /baseURL: API_BASE_URL/)
    assert.match(interviewApi, /fetch\(`\$\{API_BASE_URL\}\/api\/interview\//)
})

test('the configured module value is normalized for API consumers', () => {
    assert.equal(API_BASE_URL, normalizeApiBaseUrl(API_BASE_URL))
})

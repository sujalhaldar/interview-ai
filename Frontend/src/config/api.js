const DEFAULT_API_BASE_URL = 'http://localhost:3000'

export function normalizeApiBaseUrl(value) {
    const configuredUrl = typeof value === 'string' ? value.trim() : ''
    return (configuredUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, '') || DEFAULT_API_BASE_URL
}

export function resolveApiBaseUrl(env = import.meta.env) {
    return normalizeApiBaseUrl(env?.VITE_API_BASE_URL)
}

export const API_BASE_URL = resolveApiBaseUrl()

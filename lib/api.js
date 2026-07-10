'use client'
import { createClient } from '@/lib/supabase/client'

const API_URL = process.env.NEXT_PUBLIC_API_URL

/**
 * Thin fetch wrapper for the Express API. Attaches the Supabase access
 * token when a session exists. Throws Error(message) on non-2xx so
 * callers can toast err.message.
 */
async function apiFetch(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { 'Content-Type': 'application/json' }

    if (auth) {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.access_token) {
            headers.Authorization = `Bearer ${session.access_token}`
        }
    }

    const res = await fetch(`${API_URL}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    let data = null
    try {
        data = await res.json()
    } catch {
        // non-JSON response (e.g. 502 from proxy) — fall through
    }

    if (!res.ok) {
        throw new Error(data?.message || `Request failed (${res.status})`)
    }
    return data
}

export const api = {
    get: (path, opts) => apiFetch(path, { ...opts, method: 'GET' }),
    post: (path, body, opts) => apiFetch(path, { ...opts, method: 'POST', body }),
    put: (path, body, opts) => apiFetch(path, { ...opts, method: 'PUT', body }),
    patch: (path, body, opts) => apiFetch(path, { ...opts, method: 'PATCH', body }),
    delete: (path, opts) => apiFetch(path, { ...opts, method: 'DELETE' }),
}

'use client'
import { createBrowserClient } from '@supabase/ssr'

let client = null

/**
 * Browser Supabase client (anon key only — RLS enforced).
 * Used for auth sessions and public reads; anything money- or
 * stock-related goes through the Express API via lib/api.js.
 */
export function createClient() {
    if (!client) {
        client = createBrowserClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        )
    }
    return client
}

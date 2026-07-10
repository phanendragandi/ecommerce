import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Server-component Supabase client (anon key only — RLS enforced).
 * For reading the auth session in Server Components / route handlers.
 * The service-role key never exists in this app — server-privileged
 * work lives in /server (Express).
 */
export async function createClient() {
    const cookieStore = await cookies()

    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll()
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        )
                    } catch {
                        // setAll called from a Server Component — safe to
                        // ignore when middleware refreshes sessions.
                    }
                },
            },
        }
    )
}

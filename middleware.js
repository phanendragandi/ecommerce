import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'

/**
 * Refreshes the Supabase session cookie on every request (the @supabase/ssr
 * middleware pattern) so Server Components always see a valid session.
 * No route gating here — /seller/* is guarded client-side by
 * app/seller/layout.jsx, and every privileged action is re-checked by the
 * Express API regardless.
 */
export async function middleware(request) {
    let response = NextResponse.next({ request })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
                    response = NextResponse.next({ request })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        response.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    await supabase.auth.getUser()

    return response
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}

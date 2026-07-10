import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Only allow same-origin relative paths (blocks open-redirect payloads like
// "@evil.com", "//evil.com" or "/\evil.com" which browsers/proxies can treat
// as absolute or protocol-relative URLs).
const isSafeNext = (value) => /^\/(?!\/|\\)/.test(value)

// Exchanges the OAuth `code` for a session (Google sign-in redirect target).
export async function GET(request) {
    const { searchParams, origin } = new URL(request.url)
    const code = searchParams.get('code')
    const rawNext = searchParams.get('next') ?? '/'
    const next = isSafeNext(rawNext) ? rawNext : '/'

    if (code) {
        const supabase = await createClient()
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) {
            return NextResponse.redirect(`${origin}${next}`)
        }
    }

    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}

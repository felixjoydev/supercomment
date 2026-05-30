import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * OAuth / magic-link callback. Supabase redirects here with a `code` after the
 * user authenticates; we exchange it for a session (the server client writes the
 * auth cookies), then forward to the dashboard. Every dashboard route then
 * re-checks auth independently.
 *
 * VERIFY IN REAL ENV: the exchange depends on a live Supabase project and a
 * valid code from a real email/provider round trip.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}

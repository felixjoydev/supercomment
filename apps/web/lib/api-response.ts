import { NextResponse } from 'next/server';

/**
 * The one JSON error shape for API route handlers: `{ error: string }` at the
 * given status. Centralized so routes don't drift on the envelope, and so the
 * raw Postgres `error.message` (which leaks column/constraint names — L3) never
 * reaches a client: callers pass a deliberate, generic message instead.
 */
export function jsonError(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status });
}

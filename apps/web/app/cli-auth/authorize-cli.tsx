'use client';

import { useState } from 'react';
import { motion } from 'motion/react';
import { createClient } from '@/lib/supabase/client';
import { callbackUrl } from '@/lib/cli-auth';

const spring = { type: 'spring', duration: 0.6, bounce: 0 } as const;

type Status = 'idle' | 'working' | 'done' | 'error';

/**
 * "Authorize CLI" card. On click it reads the CURRENT browser session token
 * (client-side, never round-tripped through our server) plus the public anon
 * key + supabase URL, and POSTs them to the loopback callback the CLI opened
 * (http://127.0.0.1:<port>/callback) with the one-time `state` nonce.
 *
 * The destination is loopback-only and built from a validated port — there is
 * no attacker-controllable URL. A bad/missing port or state is surfaced rather
 * than producing a dead button.
 */
export function AuthorizeCli({
  port,
  state,
  email,
}: {
  port: number | null;
  state: string;
  email: string | null;
}) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  const invalid =
    port === null
      ? 'Missing or invalid CLI callback port.'
      : !state
        ? 'Missing authorization state.'
        : null;

  async function authorize() {
    if (port === null || !state) return;
    setStatus('working');
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: sessErr } = await supabase.auth.getSession();
      if (sessErr || !data.session) {
        throw new Error('No active session — please sign in again.');
      }
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !anonKey) {
        throw new Error('SuperComment is missing its Supabase configuration.');
      }

      const res = await fetch(callbackUrl(port), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          state,
          token: data.session.access_token,
          refreshToken: data.session.refresh_token,
          supabaseUrl,
          anonKey,
          email,
        }),
      });
      if (!res.ok) {
        throw new Error(`The CLI rejected the authorization (HTTP ${res.status}).`);
      }
      setStatus('done');
    } catch (e) {
      // A network failure here almost always means the CLI server is no longer
      // listening (it timed out or was Ctrl+C'd) — say so actionably.
      setStatus('error');
      setError(
        e instanceof TypeError
          ? 'Could not reach the SuperComment CLI. Make sure `supercomment login` is still running, then try again.'
          : e instanceof Error
            ? e.message
            : String(e),
      );
    }
  }

  return (
    <motion.div
      className="auth-card"
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring}
    >
      <h1 className="auth-wordmark">SuperComment</h1>

      {status === 'done' ? (
        <div className="empty-state" role="status">
          <p className="empty-title">✓ CLI authorized</p>
          <p className="empty-sub">
            You can close this tab and return to your terminal.
          </p>
        </div>
      ) : invalid ? (
        <div className="empty-state" role="alert">
          <p className="empty-title">Can&apos;t authorize</p>
          <p className="empty-sub">
            {invalid} Re-run <code>supercomment login</code> from your terminal.
          </p>
        </div>
      ) : (
        <>
          <p className="auth-subtitle">
            Authorize the SuperComment CLI on this machine to read your review
            comments{email ? <> as <strong>{email}</strong></> : null}.
          </p>

          <button
            type="button"
            className="btn btn-block"
            onClick={authorize}
            disabled={status === 'working'}
            style={{ marginTop: 8 }}
          >
            {status === 'working' ? 'Authorizing…' : 'Authorize CLI'}
          </button>

          {error ? (
            <p className="msg msg-err" style={{ marginTop: 12 }}>
              {error}
            </p>
          ) : null}

          <p className="auth-subtitle" style={{ marginTop: 16, fontSize: '0.85em' }}>
            This sends a short-lived session token to a local server on your own
            machine (127.0.0.1). It is never shared with anyone else.
          </p>
        </>
      )}
    </motion.div>
  );
}

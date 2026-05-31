'use client';
import { useActionState } from 'react';
import {
  signInWithEmail,
  signInWithPassword,
  signUpWithPassword,
  signInWithGitHub,
} from './actions';

/**
 * Sign-in form.
 *
 * Primary path for local dev + demos is email + PASSWORD (instant, no email
 * sent) — Supabase's built-in magic-link mailer is rate-limited and unreliable.
 * The magic-link and GitHub OAuth options remain available below.
 */
export function AuthForm({ showAuthError }: { showAuthError: boolean }) {
  const [pwState, pwSignIn, pwPending] = useActionState(signInWithPassword, {});
  const [suState, pwSignUp, suPending] = useActionState(signUpWithPassword, {});
  const [mlState, magicLink, mlPending] = useActionState(signInWithEmail, {});

  const err = pwState.error ?? suState.error ?? mlState.error;

  return (
    <div className="auth-card">
      <h1 className="auth-title">SuperComment</h1>
      <p className="auth-subtitle">Sign in to manage your team&rsquo;s previews.</p>

      {showAuthError ? (
        <p className="auth-msg auth-msg-err">
          Sign-in link was invalid or expired. Please try again.
        </p>
      ) : null}

      {suState.sent ? (
        <p className="auth-msg auth-msg-ok">
          Account created. Check your email to confirm, then sign in.
        </p>
      ) : mlState.sent ? (
        <p className="auth-msg auth-msg-ok">Check your email for a sign-in link.</p>
      ) : (
        <form className="auth-form">
          <label className="auth-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
            className="auth-input"
          />

          <label className="auth-label" htmlFor="password" style={{ marginTop: 12 }}>
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
            className="auth-input"
          />

          {err ? <p className="auth-msg auth-msg-err">{err}</p> : null}

          <button
            type="submit"
            formAction={pwSignIn}
            className="btn auth-button"
            disabled={pwPending || suPending}
            style={{ marginTop: 12 }}
          >
            {pwPending ? 'Signing in…' : 'Sign in'}
          </button>
          <button
            type="submit"
            formAction={pwSignUp}
            className="btn btn-subtle"
            disabled={pwPending || suPending}
            style={{ width: '100%', marginTop: 8 }}
          >
            {suPending ? 'Creating…' : 'Create account'}
          </button>

          <div className="auth-divider" style={{ marginTop: 16, marginBottom: 8 }}>
            <span>or</span>
          </div>

          <button
            type="submit"
            formAction={magicLink}
            className="btn btn-subtle"
            disabled={mlPending}
            style={{ width: '100%' }}
          >
            {mlPending ? 'Sending…' : 'Email me a magic link'}
          </button>
        </form>
      )}

      <form action={signInWithGitHub} style={{ marginTop: 12 }}>
        <button type="submit" className="btn btn-subtle" style={{ width: '100%' }}>
          Continue with GitHub
        </button>
      </form>
    </div>
  );
}

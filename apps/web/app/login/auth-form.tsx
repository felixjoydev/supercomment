'use client';
import { useActionState } from 'react';
import { signInWithEmail, signInWithGitHub } from './actions';

/**
 * Sign-in form. Passwordless magic link is the primary path; GitHub OAuth is a
 * secondary option. On success we show a "check your email" confirmation. The
 * session itself is established at /auth/callback.
 */
export function AuthForm({ showAuthError }: { showAuthError: boolean }) {
  const [state, formAction, pending] = useActionState(signInWithEmail, {});

  return (
    <div className="auth-card">
      <h1 className="auth-title">SuperComment</h1>
      <p className="auth-subtitle">Sign in to manage your team&rsquo;s previews.</p>

      {showAuthError ? (
        <p className="auth-msg auth-msg-err">
          Sign-in link was invalid or expired. Please try again.
        </p>
      ) : null}

      {state.sent ? (
        <p className="auth-msg auth-msg-ok">
          Check your email for a sign-in link.
        </p>
      ) : (
        <form action={formAction} className="auth-form">
          <label className="auth-label" htmlFor="email">
            Work email
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
          {state.error ? (
            <p className="auth-msg auth-msg-err">{state.error}</p>
          ) : null}
          <button type="submit" className="btn auth-button" disabled={pending}>
            {pending ? 'Sending…' : 'Email me a sign-in link'}
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

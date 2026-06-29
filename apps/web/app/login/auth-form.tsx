'use client';

import { useActionState, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Stagger, StaggerItem } from '@/components/motion';
import {
  signInWithEmail,
  signInWithPassword,
  signUpWithPassword,
  signInWithGitHub,
} from './actions';

const spring = { type: 'spring', duration: 0.6, bounce: 0 } as const;

type Mode = 'signin' | 'signup';

/**
 * Sign-in card. One primary path (email + password) with a sign-in / create
 * account flip; magic link + GitHub stay available as quiet alternatives.
 * Password auth is the dev/demo default — Supabase's built-in mailer is
 * rate-limited, so the email paths are secondary.
 */
export function AuthForm({ showAuthError }: { showAuthError: boolean }) {
  const [mode, setMode] = useState<Mode>('signin');
  const [pwState, pwSignIn, pwPending] = useActionState(signInWithPassword, {});
  const [suState, pwSignUp, suPending] = useActionState(signUpWithPassword, {});
  const [mlState, magicLink, mlPending] = useActionState(signInWithEmail, {});

  const pending = pwPending || suPending;
  const error =
    (mode === 'signin' ? pwState.error : suState.error) ?? mlState.error ?? null;

  const sent = suState.sent ? 'signup' : mlState.sent ? 'magic' : null;

  return (
    <motion.div
      className="auth-card"
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring}
    >
      <Stagger delay={0.08}>
        <StaggerItem>
          <h1 className="auth-wordmark">SuperComment</h1>
        </StaggerItem>
        <StaggerItem>
          <p className="auth-subtitle">Visual feedback your agent can act on.</p>
        </StaggerItem>

        <StaggerItem>
          <AnimatePresence mode="wait" initial={false}>
            {sent ? (
              <motion.div
                key={sent}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={spring}
              >
                <SentNote kind={sent} />
              </motion.div>
            ) : (
              <motion.div
                key="form"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={spring}
              >
                {showAuthError ? (
                  <p className="msg msg-err" style={{ marginBottom: 12 }}>
                    That sign-in link was invalid or expired. Please try again.
                  </p>
                ) : null}

                <form className="auth-form">
                  <div className="field">
                    <label className="field-label" htmlFor="email">
                      Email
                    </label>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="you@company.com"
                      className="input"
                    />
                  </div>

                  <div className="field">
                    <label className="field-label" htmlFor="password">
                      Password
                    </label>
                    <input
                      id="password"
                      name="password"
                      type="password"
                      required
                      autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                      placeholder={mode === 'signin' ? 'Your password' : 'At least 6 characters'}
                      className="input"
                    />
                  </div>

                  <AnimatePresence initial={false}>
                    {error ? (
                      <motion.p
                        className="msg msg-err"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={spring}
                      >
                        {error}
                      </motion.p>
                    ) : null}
                  </AnimatePresence>

                  <button
                    type="submit"
                    formAction={mode === 'signin' ? pwSignIn : pwSignUp}
                    className="btn btn-block"
                    disabled={pending}
                    style={{ marginTop: 4 }}
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span
                        key={`${mode}-${pending}`}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
                      >
                        {pending
                          ? mode === 'signin'
                            ? 'Signing in…'
                            : 'Creating account…'
                          : mode === 'signin'
                            ? 'Sign in'
                            : 'Create account'}
                      </motion.span>
                    </AnimatePresence>
                  </button>
                </form>

                <p className="auth-flip">
                  {mode === 'signin' ? (
                    <>
                      New here?{' '}
                      <button type="button" onClick={() => setMode('signup')}>
                        Create an account
                      </button>
                    </>
                  ) : (
                    <>
                      Already have an account?{' '}
                      <button type="button" onClick={() => setMode('signin')}>
                        Sign in
                      </button>
                    </>
                  )}
                </p>

                <div className="auth-divider">
                  <span>or</span>
                </div>

                <div className="auth-alt">
                  <form action={magicLink}>
                    <MagicLinkButton pending={mlPending} />
                  </form>
                  <form action={signInWithGitHub}>
                    <button type="submit" className="btn btn-ghost btn-block">
                      Continue with GitHub
                    </button>
                  </form>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </StaggerItem>
      </Stagger>
    </motion.div>
  );
}

/** Magic-link needs its own email input — kept compact inside a quiet row. */
function MagicLinkButton({ pending }: { pending: boolean }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost btn-block" onClick={() => setOpen(true)}>
        Email me a magic link
      </button>
    );
  }

  return (
    <motion.div
      className="create-row"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
    >
      <input
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@company.com"
        aria-label="Email for magic link"
        className="input"
        style={{ maxWidth: 'none' }}
      />
      <button type="submit" className="btn btn-ghost" disabled={pending}>
        {pending ? 'Sending…' : 'Send link'}
      </button>
    </motion.div>
  );
}

function SentNote({ kind }: { kind: 'signup' | 'magic' }) {
  return (
    <div className="empty-state" role="status">
      <p className="empty-title">Check your inbox</p>
      <p className="empty-sub">
        {kind === 'signup'
          ? 'Your account was created. Confirm your email, then sign in.'
          : 'We sent you a sign-in link. It expires shortly.'}
      </p>
    </div>
  );
}

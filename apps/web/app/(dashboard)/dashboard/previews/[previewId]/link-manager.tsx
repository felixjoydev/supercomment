'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import type { AccessMode, LinkAction } from '@/lib/link';
import { isAllowedDeployUrl } from '@/lib/external-redirect';
import { Switch } from '@/components/switch';
import { CopyButton } from '@/components/copy-button';

const spring = { type: 'spring', duration: 0.45, bounce: 0 } as const;

/**
 * Client-side link management for a single preview. Sends LinkActions to PATCH
 * /api/previews/[id] (which enforces auth + membership + RLS). Destructive
 * actions (regenerate, revoke) require an explicit confirmation step with
 * consequence copy before the request is sent (D-18).
 */
interface Props {
  previewId: string;
  name: string;
  accessMode: AccessMode;
  linkSecret: string | null;
  expiresAt: string | null;
  deployUrl: string | null;
  guestUrl: string | null;
  /** Always-present members-only share URL (/s/<slug>, no secret). */
  memberUrl: string;
}

type Confirmable = 'regenerate' | 'revoke' | null;

export function LinkManager(props: Props) {
  const router = useRouter();
  const [name, setName] = useState(props.name);
  const [expiry, setExpiry] = useState(toLocalInput(props.expiresAt));
  const [deployUrl, setDeployUrl] = useState(props.deployUrl ?? '');
  const [confirming, setConfirming] = useState<Confirmable>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(action: LinkAction) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/previews/${props.previewId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? 'Update failed');
      }
      setConfirming(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  const guestOn = props.accessMode === 'guest_link';
  const hasDestroyables = guestOn || Boolean(props.linkSecret);

  // The link we surface to copy: the guest URL when guest access is on and
  // valid, otherwise the members-only URL — so a shareable link is ALWAYS
  // visible. Toggling Guest off must not make the link appear to vanish.
  const shareUrl = (guestOn ? props.guestUrl : null) ?? props.memberUrl;

  const deployTrimmed = deployUrl.trim();
  const deployChanged = deployTrimmed !== (props.deployUrl ?? '');
  const deployValid = isAllowedDeployUrl(deployTrimmed);

  return (
    <div>
      {/* ── Review link ── */}
      <section className="panel">
        <h2 className="panel-title">Review link</h2>
        <p className="panel-sub">
          Send this link to a reviewer. They open it, land on your site (the Deploy URL below) with
          the comment toolbar on top, and the feedback they leave shows up under Comments.
        </p>

        <div className="panel-rows">
          {/* The link to share — always visible, regardless of access mode. */}
          <div className="panel-row">
            <div className="copy-field">
              <code>{shareUrl}</code>
              <CopyButton value={shareUrl} label="Copy review link" />
            </div>
          </div>
          <p className="panel-row-hint" style={{ marginTop: -6 }}>
            {guestOn && props.guestUrl
              ? 'Anyone with this link can view and comment — no sign-in needed.'
              : 'Only signed-in workspace members can open this link. Turn on Guest link below to share it with anyone.'}
          </p>

          <div className="panel-row">
            <div>
              <div className="panel-row-label">Guest link</div>
              <p className="panel-row-hint">
                {guestOn
                  ? 'On — anyone with the link can comment, no sign-in.'
                  : 'Off — members only.'}
              </p>
            </div>
            <Switch
              checked={guestOn}
              disabled={busy}
              label="Guest link"
              onChange={(next) =>
                send({ type: 'set_access_mode', accessMode: next ? 'guest_link' : 'team_only' })
              }
            />
          </div>

          <AnimatePresence initial={false}>
            {guestOn ? (
              <motion.div
                key="expiry"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={spring}
                style={{ overflow: 'hidden' }}
              >
                <div className="panel-row">
                  <div>
                    <label className="panel-row-label" htmlFor="pv-expiry">
                      Expires
                    </label>
                    <p className="panel-row-hint">The link stops working after this moment.</p>
                  </div>
                  <div className="panel-row-control">
                    <input
                      id="pv-expiry"
                      type="datetime-local"
                      value={expiry}
                      onChange={(e) => setExpiry(e.target.value)}
                      className="input"
                      style={{ width: 'auto' }}
                    />
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() =>
                        send({
                          type: 'set_expiry',
                          expiresAt: expiry ? new Date(expiry).toISOString() : null,
                        })
                      }
                    >
                      Save
                    </button>
                    {props.expiresAt ? (
                      <button
                        className="btn btn-quiet btn-sm"
                        disabled={busy}
                        onClick={() => {
                          setExpiry('');
                          send({ type: 'set_expiry', expiresAt: null });
                        }}
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </section>

      {/* ── Details ── */}
      <section className="panel">
        <h2 className="panel-title">Details</h2>

        <div className="panel-rows">
          <div className="panel-row">
            <label className="panel-row-label" htmlFor="pv-name">
              Name
            </label>
            <div className="panel-row-control">
              <input
                id="pv-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                className="input"
                style={{ width: 260 }}
              />
              <AnimatePresence initial={false}>
                {name.trim() && name.trim() !== props.name ? (
                  <motion.div
                    key="save-name"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
                  >
                    <button
                      className="btn btn-sm"
                      disabled={busy}
                      onClick={() => send({ type: 'rename', name: name.trim() })}
                    >
                      Save
                    </button>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>

          <div className="panel-row">
            <div>
              <label className="panel-row-label" htmlFor="pv-deploy-url">
                Deploy URL
              </label>
              <p className="panel-row-hint">
                Your always-on deployed preview origin. Reviewers opening the embedded link are
                redirected here. Must be a public https URL — no localhost or IP address.
              </p>
            </div>
            <div className="panel-row-control">
              <input
                id="pv-deploy-url"
                type="url"
                inputMode="url"
                value={deployUrl}
                onChange={(e) => setDeployUrl(e.target.value)}
                placeholder="https://your-app.vercel.app"
                className="input"
                style={{ width: 320 }}
              />
              <AnimatePresence initial={false}>
                {deployChanged && deployValid ? (
                  <motion.div
                    key="save-deploy-url"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
                  >
                    <button
                      className="btn btn-sm"
                      disabled={busy}
                      onClick={() => send({ type: 'set_deploy_url', deployUrl: deployTrimmed })}
                    >
                      Save
                    </button>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {deployChanged && deployTrimmed && !deployValid ? (
              <motion.p
                className="msg msg-err"
                style={{ marginTop: 0 }}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={spring}
              >
                Enter a public https URL (e.g. https://your-app.vercel.app) — no http, localhost, or
                IP addresses.
              </motion.p>
            ) : null}
          </AnimatePresence>
        </div>

        {hasDestroyables ? (
          <div className="danger-zone">
            <AnimatePresence mode="wait" initial={false}>
              {confirming === 'regenerate' ? (
                <ConfirmCard
                  key="confirm-regenerate"
                  message="Regenerating creates a new secret link. The current guest link stops working immediately for anyone who already has it."
                  confirmLabel="Regenerate link"
                  busy={busy}
                  onCancel={() => setConfirming(null)}
                  onConfirm={() => send({ type: 'regenerate' })}
                />
              ) : confirming === 'revoke' ? (
                <ConfirmCard
                  key="confirm-revoke"
                  message="Revoking clears the secret and switches this review link to members only. The guest link stops working and cannot be restored — you would have to enable a new one."
                  confirmLabel="Revoke link"
                  busy={busy}
                  onCancel={() => setConfirming(null)}
                  onConfirm={() => send({ type: 'revoke' })}
                />
              ) : (
                <motion.div
                  key="danger-actions"
                  className="danger-actions"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <button
                    className="btn btn-danger-quiet btn-sm"
                    disabled={busy}
                    onClick={() => setConfirming('regenerate')}
                  >
                    Regenerate secret link…
                  </button>
                  <button
                    className="btn btn-danger-quiet btn-sm"
                    disabled={busy || (!guestOn && !props.linkSecret)}
                    onClick={() => setConfirming('revoke')}
                  >
                    Revoke guest link…
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : null}

        <AnimatePresence initial={false}>
          {error ? (
            <motion.p
              className="msg msg-err"
              style={{ marginTop: 12 }}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={spring}
            >
              {error}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </section>
    </div>
  );
}

function ConfirmCard({
  message,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  message: string;
  confirmLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <motion.div
      className="confirm-card"
      role="alertdialog"
      aria-live="assertive"
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.98 }}
      transition={spring}
    >
      <p className="confirm-msg">{message}</p>
      <div className="confirm-actions">
        <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-danger btn-sm" onClick={onConfirm} disabled={busy}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </motion.div>
  );
}

/** Convert an ISO timestamp to a datetime-local input value. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

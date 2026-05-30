'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AccessMode, LinkAction } from '@/lib/link';

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
  guestUrl: string | null;
}

type Confirmable = 'regenerate' | 'revoke' | null;

export function LinkManager(props: Props) {
  const router = useRouter();
  const [name, setName] = useState(props.name);
  const [expiry, setExpiry] = useState(toLocalInput(props.expiresAt));
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

  function setAccessMode(accessMode: AccessMode) {
    const action: LinkAction = { type: 'set_access_mode', accessMode };
    return send(action);
  }

  return (
    <section className="link-manager">
      {/* Rename */}
      <div className="lm-row">
        <label className="lm-label" htmlFor="pv-name">
          Name
        </label>
        <div className="lm-control">
          <input
            id="pv-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            className="inline-input"
          />
          <button
            className="btn"
            disabled={busy || !name.trim() || name.trim() === props.name}
            onClick={() => send({ type: 'rename', name: name.trim() })}
          >
            Save
          </button>
        </div>
      </div>

      {/* Access mode */}
      <div className="lm-row">
        <span className="lm-label">Access</span>
        <div className="lm-control">
          <span className="lm-value">{guestOn ? 'Guest link' : 'Team only'}</span>
          {guestOn ? (
            <button
              className="btn btn-subtle"
              disabled={busy}
              onClick={() => setAccessMode('team_only')}
            >
              Switch to team only
            </button>
          ) : (
            <button className="btn" disabled={busy} onClick={() => setAccessMode('guest_link')}>
              Enable guest link
            </button>
          )}
        </div>
      </div>

      {/* Guest URL — only shown when a valid link exists */}
      {props.guestUrl ? (
        <div className="lm-row">
          <span className="lm-label">Guest URL</span>
          <code className="lm-url">{props.guestUrl}</code>
        </div>
      ) : null}

      {/* Expiry */}
      <div className="lm-row">
        <label className="lm-label" htmlFor="pv-expiry">
          Expires
        </label>
        <div className="lm-control">
          <input
            id="pv-expiry"
            type="datetime-local"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            className="inline-input"
          />
          <button
            className="btn"
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
              className="btn btn-subtle"
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

      {/* Danger zone: regenerate + revoke (confirmation required) */}
      <div className="lm-danger">
        <h2 className="lm-danger-title">Danger zone</h2>

        {confirming === 'regenerate' ? (
          <ConfirmBox
            message="Regenerating creates a NEW secret link. The current guest link stops working immediately for anyone who already has it."
            confirmLabel="Regenerate link"
            busy={busy}
            onCancel={() => setConfirming(null)}
            onConfirm={() => send({ type: 'regenerate' })}
          />
        ) : (
          <button
            className="btn btn-warning"
            disabled={busy}
            onClick={() => setConfirming('regenerate')}
          >
            Regenerate secret link
          </button>
        )}

        {confirming === 'revoke' ? (
          <ConfirmBox
            message="Revoking clears the secret and switches this preview to team-only. The guest link stops working and cannot be restored — you would have to enable a new one."
            confirmLabel="Revoke link"
            busy={busy}
            onCancel={() => setConfirming(null)}
            onConfirm={() => send({ type: 'revoke' })}
          />
        ) : (
          <button
            className="btn btn-danger"
            disabled={busy || (!guestOn && !props.linkSecret)}
            onClick={() => setConfirming('revoke')}
          >
            Revoke guest link
          </button>
        )}
      </div>

      {error ? <p className="auth-msg auth-msg-err">{error}</p> : null}
    </section>
  );
}

function ConfirmBox({
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
    <div className="confirm-box" role="alertdialog" aria-live="assertive">
      <p className="confirm-msg">{message}</p>
      <div className="confirm-actions">
        <button className="btn btn-subtle" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-danger" onClick={onConfirm} disabled={busy}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </div>
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

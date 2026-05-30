'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Inline create-preview form. Posts to the /api/previews route handler (which
 * enforces auth + membership + RLS and defaults access_mode to team_only), then
 * refreshes the server-rendered list.
 */
export function CreatePreviewForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/previews', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, name: name.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? 'Failed to create preview');
      }
      setName('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create preview');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="inline-form">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={120}
        placeholder="New preview name"
        aria-label="New preview name"
        className="inline-input"
      />
      <button type="submit" className="btn" disabled={busy}>
        {busy ? 'Creating…' : 'Add preview'}
      </button>
      {error ? <p className="auth-msg auth-msg-err">{error}</p> : null}
    </form>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPreview, getProject, getCommentsForPreview } from '@/lib/data';
import { deriveStatus } from '@/lib/status';
import { buildGuestUrl, type AccessMode } from '@/lib/link';
import { StatusBadge } from '../../status-badge';
import { LinkManager } from './link-manager';
import { CommentBoard } from './comments/comment-board';

/**
 * Preview detail / settings page: live/offline status + full link management
 * (rename, access mode, expiry, regenerate, revoke). RLS-scoped — a non-member
 * gets notFound. The actual mutations go through PATCH /api/previews/[id].
 */
export default async function PreviewPage({
  params,
}: {
  params: Promise<{ previewId: string }>;
}) {
  const { previewId } = await params;
  const preview = await getPreview(previewId);
  if (!preview) notFound();

  const project = await getProject(preview.project_id);

  const status = deriveStatus({
    dbStatus: preview.status,
    lastHeartbeatAt: preview.last_heartbeat_at,
  });

  const linkState = {
    name: preview.name,
    access_mode: preview.access_mode as AccessMode,
    link_secret: preview.link_secret,
    expires_at: preview.expires_at,
  };

  // Base URL for the public guest link. NEXT_PUBLIC_APP_URL is optional; the
  // client also has its own origin, but the secret must never appear unless the
  // link is currently valid (revoked/expired → null).
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const guestUrl = baseUrl ? buildGuestUrl(baseUrl, preview.slug, linkState) : null;

  // Initial RLS-scoped comment list; CommentBoard keeps it live via the private
  // broadcast channel. Reaching this page already implies team membership (RLS
  // notFound otherwise), and the resolve/dismiss RPCs re-check membership, so
  // any member who can view may also act on comments.
  const initialComments = await getCommentsForPreview(previewId).catch(() => []);
  const canMutate = true;

  return (
    <div>
      <div className="page-head">
        {project ? (
          <Link href={`/dashboard/projects/${project.id}`} className="back-link">
            ← {project.name}
          </Link>
        ) : null}
        <div className="title-row">
          <h1 className="page-title">{preview.name}</h1>
          <StatusBadge status={status} />
        </div>
      </div>

      <dl className="kv">
        <dt>Slug</dt>
        <dd>/s/{preview.slug}</dd>
        <dt>Last heartbeat</dt>
        <dd>{preview.last_heartbeat_at ?? 'never'}</dd>
      </dl>

      <LinkManager
        previewId={preview.id}
        name={preview.name}
        accessMode={linkState.access_mode}
        linkSecret={preview.link_secret}
        expiresAt={preview.expires_at}
        guestUrl={guestUrl}
      />

      <section className="comments-section" style={{ marginTop: '2rem' }}>
        <h2 className="page-title" style={{ fontSize: '1.125rem' }}>
          Comments
        </h2>
        <CommentBoard
          previewId={preview.id}
          initialComments={initialComments}
          canMutate={canMutate}
        />
      </section>
    </div>
  );
}

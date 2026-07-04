import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getPreview,
  getProject,
  getCommentsForPreview,
  canCurrentUserSendToAgent,
} from '@/lib/data';
import { deriveStatus } from '@/lib/status';
import { buildGuestUrl, type AccessMode } from '@/lib/link';
import { hasEnhancedContext } from '@/lib/comments/handoff';
import { Stagger, StaggerItem } from '@/components/motion';
import { StatusBadge } from '../../status-badge';
import { LinkManager } from './link-manager';
import { EnhancedContext } from './enhanced-context';
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
  // The members-only share URL (no secret) — always available, so the review
  // link is never hidden: any signed-in workspace member can open it directly,
  // and it's what we surface when the guest link is off.
  const memberUrl = `${baseUrl.replace(/\/+$/, '')}/s/${preview.slug}`;

  // Initial RLS-scoped comment list; CommentBoard keeps it live via the private
  // broadcast channel. Reaching this page already implies workspace membership (RLS
  // notFound otherwise), and the resolve/dismiss RPCs re-check membership, so
  // any member who can view may also act on comments.
  const initialComments = await getCommentsForPreview(previewId).catch(() => []);
  const canMutate = true;
  // Phase 2: gate the "Send to agent" button on the current member's permission.
  const canSendToAgent = await canCurrentUserSendToAgent(previewId).catch(() => false);

  // R10: auto-detect whether exact file:line is flowing in (any comment carries
  // a build-time source stamp). Drives the "detected / not detected" panel.
  const enhancedDetected = hasEnhancedContext(initialComments);

  return (
    <Stagger>
      <StaggerItem>
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
      </StaggerItem>

      <StaggerItem>
        <dl className="kv">
          <dt>Stable link</dt>
          <dd>
            <code>/s/{preview.slug}</code>
          </dd>
          <dt>Last heartbeat</dt>
          <dd>{formatHeartbeat(preview.last_heartbeat_at)}</dd>
        </dl>
      </StaggerItem>

      <StaggerItem>
        <LinkManager
          previewId={preview.id}
          name={preview.name}
          accessMode={linkState.access_mode}
          linkSecret={preview.link_secret}
          expiresAt={preview.expires_at}
          deployUrl={preview.deploy_url}
          guestUrl={guestUrl}
          memberUrl={memberUrl}
        />
      </StaggerItem>

      <StaggerItem>
        <EnhancedContext previewId={preview.id} detected={enhancedDetected} />
      </StaggerItem>

      <StaggerItem>
        <section className="panel">
          <h2 className="panel-title">Comments</h2>
          <p className="panel-sub">Feedback lands here in realtime as reviewers annotate.</p>
          <CommentBoard
            previewId={preview.id}
            slug={preview.slug}
            baseUrl={baseUrl}
            initialComments={initialComments}
            canMutate={canMutate}
            canSendToAgent={canSendToAgent}
          />
        </section>
      </StaggerItem>
    </Stagger>
  );
}

/** Human heartbeat: "3m ago" beats an ISO timestamp for a glanceable header. */
function formatHeartbeat(iso: string | null): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'never';
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return new Date(iso).toLocaleDateString();
}

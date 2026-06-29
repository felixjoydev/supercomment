import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getProject, listPreviews } from '@/lib/data';
import { deriveStatus } from '@/lib/status';
import { isGuestLinkValid } from '@/lib/link';
import { Stagger, StaggerItem } from '@/components/motion';
import { CopyButton } from '@/components/copy-button';
import { StatusBadge } from '../../status-badge';

/**
 * Project page: the "here's your snippet + your review link(s)" surface. Shows
 * the universal /sc-loader embed snippet (with this app's own origin) and the
 * project's auto-created review link(s), each linking through to its comments /
 * link-management page. RLS-scoped — a non-member sees notFound.
 */
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  const reviewLinks = await listPreviews(projectId);
  const snippet = `<script src="${await getAppOrigin()}/sc-loader" async></script>`;

  return (
    <Stagger>
      <StaggerItem>
        <div className="page-head">
          <Link href="/dashboard" className="back-link">
            ← All workspaces
          </Link>
          <h1 className="page-title">{project.name}</h1>
          <p className="page-sub">
            Drop the snippet into your preview build, then share a review link to collect feedback.
          </p>
        </div>
      </StaggerItem>

      <StaggerItem>
        <section className="panel">
          <h2 className="panel-title">Install snippet</h2>
          <p className="panel-sub">
            Add this to your preview / staging build&rsquo;s <code>&lt;head&gt;</code> — never
            production. Reviewers comment directly on the running app; nothing for them to install.
          </p>
          <div className="copy-field">
            <code>{snippet}</code>
            <CopyButton value={snippet} label="Copy install snippet" />
          </div>
        </section>
      </StaggerItem>

      <StaggerItem>
        <section className="panel">
          <h2 className="panel-title">Review links</h2>
          <p className="panel-sub">
            Share a link to open the app in review mode. Open one to manage sharing and read its
            comments.
          </p>

          {reviewLinks.length === 0 ? (
            <p className="empty-inline" style={{ margin: 0 }}>
              No review link yet.
            </p>
          ) : (
            <div className="tile-grid" style={{ gridTemplateColumns: '1fr' }}>
              {reviewLinks.map((rl) => {
                const status = deriveStatus({
                  dbStatus: rl.status,
                  lastHeartbeatAt: rl.last_heartbeat_at,
                });
                const guestOn = isGuestLinkValid({
                  access_mode: rl.access_mode,
                  link_secret: rl.link_secret,
                  expires_at: rl.expires_at,
                });
                return (
                  <Link key={rl.id} href={`/dashboard/previews/${rl.id}`} className="tile">
                    <span className="tile-row">
                      <span className="tile-title">{rl.name}</span>
                      <StatusBadge status={status} />
                    </span>
                    <span className="tile-meta">
                      {guestOn ? 'Guest link on' : 'Members only'} · <code>/s/{rl.slug}</code>
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </StaggerItem>
    </Stagger>
  );
}

/**
 * The SuperComment app's own origin, used to build the universal embed snippet.
 * Prefers NEXT_PUBLIC_APP_URL; otherwise derives it from the incoming request
 * (the host that serves /sc-loader is itself the token-exchange backend).
 */
async function getAppOrigin(): Promise<string> {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '');
  if (envUrl) return envUrl;
  const h = await headers();
  const host = h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

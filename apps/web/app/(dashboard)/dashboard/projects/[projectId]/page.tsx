import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProject, listPreviews } from '@/lib/data';
import { deriveStatus } from '@/lib/status';
import { isGuestLinkValid } from '@/lib/link';
import { StatusBadge } from '../../status-badge';
import { CreatePreviewForm } from '../../previews-form';

/**
 * Project page: lists the project's previews with live/offline status and a
 * quick access-mode indicator. RLS-scoped — a non-member sees notFound.
 */
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  const previews = await listPreviews(projectId);

  return (
    <div>
      <div className="page-head">
        <Link href="/dashboard" className="back-link">
          ← All teams
        </Link>
        <h1 className="page-title">{project.name}</h1>
      </div>

      {previews.length === 0 ? (
        <p className="empty">No previews yet. Add one to get a shareable link.</p>
      ) : (
        <ul className="card-list">
          {previews.map((pv) => {
            const status = deriveStatus({
              dbStatus: pv.status,
              lastHeartbeatAt: pv.last_heartbeat_at,
            });
            const guestOn = isGuestLinkValid({
              access_mode: pv.access_mode,
              link_secret: pv.link_secret,
              expires_at: pv.expires_at,
            });
            return (
              <li key={pv.id} className="card">
                <div className="card-head">
                  <Link href={`/dashboard/previews/${pv.id}`} className="card-title">
                    {pv.name}
                  </Link>
                  <StatusBadge status={status} />
                </div>
                <p className="empty">
                  {guestOn ? 'Guest link enabled' : 'Team only'} · /s/{pv.slug}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <CreatePreviewForm projectId={projectId} />
    </div>
  );
}

import Link from 'next/link';
import {
  ensureDefaultWorkspace,
  listProjectsForWorkspaces,
  listWorkspaceMembers,
  type ProjectRow,
} from '@/lib/data';
import { Stagger, StaggerItem } from '@/components/motion';
import { CreateWorkspaceForm, CreateProjectForm } from './forms';
import { WorkspaceMembers } from './members';

/**
 * Dashboard home: the workspace → project navigation surface. Reads are
 * RLS-scoped, so a member only sees their own workspaces/projects. A brand-new
 * user is bootstrapped a default workspace (U4) so they land straight on
 * "create a project" — no manual workspace step.
 */
export default async function DashboardPage() {
  const workspaces = await ensureDefaultWorkspace();
  // WEB-9: fetch every workspace's projects in ONE query instead of one per
  // WorkspaceSection (N+1). VERIFY IN REAL ENV: confirm the grouped result
  // matches the per-workspace lists against the live DB.
  const projectsByWorkspace = await listProjectsForWorkspaces(
    workspaces.map((w) => w.id),
  );

  return (
    <Stagger>
      <StaggerItem>
        <div className="page-head">
          <h1 className="page-title">Your workspaces</h1>
        </div>
      </StaggerItem>

      {workspaces.map((workspace) => (
        <StaggerItem key={workspace.id}>
          <WorkspaceSection
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            projects={projectsByWorkspace.get(workspace.id) ?? []}
          />
        </StaggerItem>
      ))}

      <StaggerItem>
        <CreateWorkspaceForm />
      </StaggerItem>
    </Stagger>
  );
}

/** A workspace section listing its projects as tiles + member management. */
async function WorkspaceSection({
  workspaceId,
  workspaceName,
  projects,
}: {
  workspaceId: string;
  workspaceName: string;
  projects: ProjectRow[];
}) {
  const memberList = await listWorkspaceMembers(workspaceId).catch(() => ({
    members: [],
    viewerIsOwner: false,
  }));
  return (
    <section className="workspace-section">
      <div className="workspace-head">
        <h2 className="workspace-name">{workspaceName}</h2>
      </div>

      {projects.length === 0 ? (
        <p className="empty-inline" style={{ margin: '0 0 14px' }}>
          No projects yet — add the first one below.
        </p>
      ) : (
        <div className="tile-grid">
          {projects.map((p) => (
            <Link key={p.id} href={`/dashboard/projects/${p.id}`} className="tile">
              <span className="tile-row">
                <span className="tile-title">{p.name}</span>
                <span className="tile-arrow" aria-hidden="true">
                  →
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}

      <CreateProjectForm workspaceId={workspaceId} />

      <WorkspaceMembers
        workspaceId={workspaceId}
        members={memberList.members}
        viewerIsOwner={memberList.viewerIsOwner}
      />
    </section>
  );
}

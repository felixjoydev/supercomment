import Link from 'next/link';
import { listTeams, listProjects } from '@/lib/data';
import { CreateTeamForm, CreateProjectForm } from './forms';

/**
 * Dashboard home: the team → project navigation surface. Reads are RLS-scoped,
 * so a member only sees their own teams/projects. New users with no team see a
 * first-team bootstrap prompt (create_team RPC).
 */
export default async function DashboardPage() {
  const teams = await listTeams();

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Your teams</h1>
      </div>

      {teams.length === 0 ? (
        <div>
          <p className="empty">
            You&rsquo;re not on a team yet. Create one to start managing previews.
          </p>
          <CreateTeamForm />
        </div>
      ) : (
        <>
          <ul className="card-list">
            {teams.map((team) => (
              <TeamCard key={team.id} teamId={team.id} teamName={team.name} />
            ))}
          </ul>
          <CreateTeamForm />
        </>
      )}
    </div>
  );
}

/** A team card listing its projects. */
async function TeamCard({ teamId, teamName }: { teamId: string; teamName: string }) {
  const projects = await listProjects(teamId);
  return (
    <li className="card">
      <div className="card-head">
        <h2 className="card-title">{teamName}</h2>
      </div>
      {projects.length === 0 ? (
        <p className="empty">No projects yet.</p>
      ) : (
        <ul className="sub-list">
          {projects.map((p) => (
            <li key={p.id} className="sub-item">
              <Link href={`/dashboard/projects/${p.id}`}>{p.name}</Link>
            </li>
          ))}
        </ul>
      )}
      <CreateProjectForm teamId={teamId} />
    </li>
  );
}

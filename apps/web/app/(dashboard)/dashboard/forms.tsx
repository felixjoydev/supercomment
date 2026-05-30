'use client';
import { useRef } from 'react';
import { createTeamAction, createProjectAction } from './actions';

/**
 * Inline create-team form. Submits to the createTeamAction server action, which
 * bootstraps the team + owner membership via the create_team RPC.
 */
export function CreateTeamForm() {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      action={async (fd) => {
        await createTeamAction(fd);
        ref.current?.reset();
      }}
      className="inline-form"
    >
      <input
        name="name"
        required
        maxLength={80}
        placeholder="New team name"
        aria-label="New team name"
        className="inline-input"
      />
      <button type="submit" className="btn">
        Create team
      </button>
    </form>
  );
}

/** Inline create-project form under a team. */
export function CreateProjectForm({ teamId }: { teamId: string }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      action={async (fd) => {
        await createProjectAction(fd);
        ref.current?.reset();
      }}
      className="inline-form"
    >
      <input type="hidden" name="teamId" value={teamId} />
      <input
        name="name"
        required
        maxLength={120}
        placeholder="New project name"
        aria-label="New project name"
        className="inline-input"
      />
      <button type="submit" className="btn btn-subtle">
        Add project
      </button>
    </form>
  );
}

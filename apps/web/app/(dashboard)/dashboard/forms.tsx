'use client';

import { useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { createWorkspaceAction, createProjectAction } from './actions';

/**
 * Inline create-workspace form. Submits to the createWorkspaceAction server
 * action, which bootstraps the workspace + owner membership via the
 * create_workspace RPC.
 */
export function CreateWorkspaceForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      action={async (fd) => {
        await createWorkspaceAction(fd);
        ref.current?.reset();
      }}
      className="create-row"
    >
      <input
        name="name"
        required
        maxLength={80}
        placeholder="New workspace name"
        aria-label="New workspace name"
        className="input"
        autoFocus={autoFocus}
      />
      <SubmitButton pendingLabel="Creating…">Create workspace</SubmitButton>
    </form>
  );
}

/** Inline create-project form under a workspace. */
export function CreateProjectForm({ workspaceId }: { workspaceId: string }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      action={async (fd) => {
        await createProjectAction(fd);
        ref.current?.reset();
      }}
      className="create-row"
    >
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input
        name="name"
        required
        maxLength={120}
        placeholder="New project name"
        aria-label="New project name"
        className="input"
      />
      <SubmitButton ghost pendingLabel="Adding…">
        Add project
      </SubmitButton>
    </form>
  );
}

function SubmitButton({
  children,
  pendingLabel,
  ghost = false,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  ghost?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={ghost ? 'btn btn-ghost' : 'btn'} disabled={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}

'use client';

import { useState, useTransition } from 'react';

import { Switch } from '@/components/switch';
import type { WorkspaceMemberRow } from '@/lib/data';
import { setMemberSendToAgentAction } from './actions';

/**
 * Workspace members management (Phase 2). Lists the workspace's members and, for
 * the OWNER, exposes a per-member "Send to agent" toggle governing whether that
 * member may hand comments/templates to the coding agent. Non-owners see the
 * state read-only. The toggle is optimistic and reverts on failure; the
 * set_member_send_to_agent RPC is the real (owner-gated) guard.
 */
export function WorkspaceMembers({
  workspaceId,
  members,
  viewerIsOwner,
}: {
  workspaceId: string;
  members: WorkspaceMemberRow[];
  viewerIsOwner: boolean;
}) {
  if (members.length === 0) return null;
  return (
    <div className="members">
      <div className="members-head">
        <h3 className="members-title">Members</h3>
        <span className="members-sub">
          {viewerIsOwner
            ? 'Choose who can send feedback to your coding agent.'
            : 'Who can send feedback to the coding agent.'}
        </span>
      </div>
      <ul className="member-list">
        {members.map((member) => (
          <MemberRow
            key={member.userId}
            workspaceId={workspaceId}
            member={member}
            canEdit={viewerIsOwner}
          />
        ))}
      </ul>
    </div>
  );
}

function MemberRow({
  workspaceId,
  member,
  canEdit,
}: {
  workspaceId: string;
  member: WorkspaceMemberRow;
  canEdit: boolean;
}) {
  const [checked, setChecked] = useState(member.canSendToAgent);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    if (!canEdit || pending) return;
    const prev = checked;
    setChecked(next); // optimistic
    setError(null);
    startTransition(async () => {
      try {
        await setMemberSendToAgentAction({
          workspaceId,
          memberUserId: member.userId,
          value: next,
        });
      } catch {
        setChecked(prev); // revert on failure
        setError('Could not update');
      }
    });
  }

  return (
    <li className="member-row">
      <span className="member-identity">
        <span className="member-email">{member.email ?? member.userId}</span>
        <span className="member-role">
          {member.role}
          {member.isSelf ? ' · you' : ''}
        </span>
      </span>
      <span className="member-control">
        {error ? <span className="member-error">{error}</span> : null}
        <span className="member-toggle-label">Send to agent</span>
        <Switch
          checked={checked}
          onChange={toggle}
          disabled={!canEdit || pending}
          label={`Allow ${member.email ?? 'this member'} to send to agent`}
        />
      </span>
    </li>
  );
}

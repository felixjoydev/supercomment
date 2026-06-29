-- =============================================================================
-- SuperComment — heartbeat + queue-consumer RPCs (U4/U5 local-helper writes)
-- =============================================================================
-- The CLI channel (apps/cli/src/channel) has always expected these four
-- security-definer RPCs — its adapters in channel/index.ts call them and the
-- code comments note they were "not yet in the migrations". Without them the
-- developer's `supercomment start` heartbeat fails (so the dashboard flips a
-- live preview to "offline" after the stale window) and the "Send to Claude"
-- comment_queue is never drained (rows sit at status=pending forever). This
-- migration adds them.
--
-- Numbering: files on feat/supercomment-mvp end at 0011; 0012-0014 are reserved
-- by the hardening branch (already applied to the dev DB as
-- share_access_gate_and_tunnel_allowlist / guest_abuse_hardening / team_invites),
-- so this lands at 0015 to avoid a collision on merge.
--
-- Style matches 0003_rpcs.sql exactly: SECURITY DEFINER + `set search_path = ''`
-- + fully schema-qualified identifiers, member-gated by the is_preview_team_member
-- helper (0002), with the default PUBLIC execute grant revoked and EXECUTE
-- granted to `authenticated`. The local helper authenticates as the developer
-- member (apikey = anon key, Authorization = member JWT), so it runs as
-- `authenticated` and these gates apply to it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- preview_heartbeat — member-only. Marks the preview live and stamps the beat.
--   The CLI calls this on an interval while sharing; deriveStatus() treats a
--   beat older than the stale window as offline, so a steady beat keeps the
--   dashboard pill "Live".
-- ---------------------------------------------------------------------------
create or replace function public.preview_heartbeat(p_preview_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_preview_team_member(p_preview_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.previews
  set status            = 'live',
      last_heartbeat_at = now()
  where id = p_preview_id;
end;
$$;

revoke execute on function public.preview_heartbeat(uuid) from public;
grant execute on function public.preview_heartbeat(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- preview_offline — member-only. Flips the preview offline on clean shutdown
--   (Ctrl-C / stop). Leaves current_tunnel_url intact for diagnostics; the
--   share route gates on status, not the stored URL.
-- ---------------------------------------------------------------------------
create or replace function public.preview_offline(p_preview_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_preview_team_member(p_preview_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.previews
  set status = 'offline'
  where id = p_preview_id;
end;
$$;

revoke execute on function public.preview_offline(uuid) from public;
grant execute on function public.preview_offline(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- claim_next_queue_item — member-only. Atomically claims the oldest pending
--   queue row for the preview (pending -> working) and returns it, or NO ROWS
--   when nothing is pending. FOR UPDATE SKIP LOCKED lets multiple drainers run
--   without claiming the same row twice.
--
--   Returns SETOF (0 or 1 rows), NOT a single composite: a scalar-composite
--   function returning NULL surfaces through PostgREST as an all-NULL row
--   object, which the CLI consumer would mistake for a real (phantom) item and
--   then fail to finish. SETOF returning zero rows surfaces as [] — an honest
--   "nothing pending".
-- ---------------------------------------------------------------------------
create or replace function public.claim_next_queue_item(p_preview_id uuid)
returns setof public.comment_queue
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_preview_team_member(p_preview_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- Lock the oldest pending row, skipping any a concurrent drainer holds.
  select id into v_id
  from public.comment_queue
  where preview_id = p_preview_id
    and status = 'pending'
  order by created_at asc
  for update skip locked
  limit 1;

  if v_id is null then
    return;  -- 0 rows -> [] over PostgREST (no phantom)
  end if;

  return query
    update public.comment_queue
    set status = 'working'
    where id = v_id
    returning *;
end;
$$;

revoke execute on function public.claim_next_queue_item(uuid) from public;
grant execute on function public.claim_next_queue_item(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- finish_queue_item — member-only. Moves a claimed row to a terminal state
--   (done | failed) and records an optional summary. Authorized against the
--   row's own preview team.
-- ---------------------------------------------------------------------------
create or replace function public.finish_queue_item(
  p_item_id uuid,
  p_status  text,
  p_summary text default null
)
returns public.comment_queue
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preview uuid;
  v_item    public.comment_queue%rowtype;
begin
  select preview_id into v_preview
  from public.comment_queue
  where id = p_item_id;

  if v_preview is null then
    raise exception 'queue_item_not_found' using errcode = 'P0001';
  end if;

  if not public.is_preview_team_member(v_preview) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_status not in ('done', 'failed') then
    raise exception 'invalid_finish_status' using errcode = 'P0001';
  end if;

  update public.comment_queue
  set status  = p_status,
      summary = coalesce(p_summary, summary)
  where id = p_item_id
  returning * into v_item;

  return v_item;
end;
$$;

revoke execute on function public.finish_queue_item(uuid, text, text) from public;
grant execute on function public.finish_queue_item(uuid, text, text) to authenticated;

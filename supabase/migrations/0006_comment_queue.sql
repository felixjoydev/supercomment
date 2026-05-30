-- =============================================================================
-- SuperComment — U9 comment_queue (Send-to-Claude handoff queue)
-- =============================================================================
-- The dashboard's "Send to Claude" button enqueues a comment for the local
-- helper's MCP queue consumer (U5/U12) to pick up later. A row here means "the
-- agent should look at this comment". The consumer flips status pending →
-- working → done/failed.
--
-- RLS: only team members of the preview may see/insert/update its queue rows
-- (reusing the is_preview_team_member helper from 0002). A partial unique index
-- on comment_id (where the row is still active) prevents duplicate live
-- enqueues of the same comment without blocking a fresh re-send after a prior
-- attempt has finished (done/failed).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table. Status uses a text column + CHECK constraint (matching the style of
-- the other tables in 0001, which model their enums as text + check rather than
-- Postgres enum types):
--   status : pending | working | done | failed
-- ---------------------------------------------------------------------------
create table if not exists public.comment_queue (
  id           uuid primary key default gen_random_uuid(),
  preview_id   uuid not null references public.previews (id) on delete cascade,
  comment_id   uuid not null references public.comments (id) on delete cascade,
  status       text not null default 'pending'
                 check (status in ('pending', 'working', 'done', 'failed')),
  requested_by uuid references auth.users (id) on delete set null,
  summary      text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists comment_queue_preview_idx on public.comment_queue (preview_id);
create index if not exists comment_queue_status_idx on public.comment_queue (preview_id, status);

-- One active (pending|working) queue row per comment: prevents accidental
-- double-enqueue while an attempt is in flight, while still allowing a new
-- request after the previous one reached a terminal state.
create unique index if not exists comment_queue_active_uniq
  on public.comment_queue (comment_id)
  where status in ('pending', 'working');

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_comment_queue_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists comment_queue_touch_updated_at on public.comment_queue;
create trigger comment_queue_touch_updated_at
  before update on public.comment_queue
  for each row execute function public.touch_comment_queue_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — team members of the preview may select/insert/update; no client deletes.
-- ---------------------------------------------------------------------------
alter table public.comment_queue enable row level security;

drop policy if exists "comment_queue read" on public.comment_queue;
create policy "comment_queue read"
  on public.comment_queue
  for select
  to authenticated
  using (public.is_preview_team_member(preview_id));

drop policy if exists "comment_queue insert" on public.comment_queue;
create policy "comment_queue insert"
  on public.comment_queue
  for insert
  to authenticated
  with check (public.is_preview_team_member(preview_id));

drop policy if exists "comment_queue update" on public.comment_queue;
create policy "comment_queue update"
  on public.comment_queue
  for update
  to authenticated
  using (public.is_preview_team_member(preview_id))
  with check (public.is_preview_team_member(preview_id));

-- ---------------------------------------------------------------------------
-- Grants — base privileges (RLS still applies on top).
-- ---------------------------------------------------------------------------
grant select, insert, update on public.comment_queue to authenticated;

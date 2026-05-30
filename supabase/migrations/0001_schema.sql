-- =============================================================================
-- SuperComment — U2 schema (tables, constraints, indexes)
-- =============================================================================
-- Multi-tenant data model. Column CHECK constraints mirror the Zod enums in
-- packages/shared/src/schema.ts (the single source of truth):
--   intent       : fix | change | question
--   severity     : critical | important | minor
--   trust_level  : member | guest
--   status       : open | resolved | dismissed
--   fidelity     : live | snapshot
-- Plus two preview-only enums not in the shared contract:
--   access_mode  : team_only | guest_link
--   status (preview): live | offline
--
-- RLS, the security-definer membership helpers, the guest/member write RPCs,
-- and realtime broadcast are added in 0002 / 0003 / 0004.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- teams
-- ---------------------------------------------------------------------------
create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- team_members — links auth.users to teams; the basis of all RLS membership.
-- ---------------------------------------------------------------------------
create table if not exists public.team_members (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null default 'member'
                check (role in ('owner', 'admin', 'member')),
  created_at  timestamptz not null default now(),
  unique (team_id, user_id)
);

create index if not exists team_members_team_id_idx on public.team_members (team_id);
create index if not exists team_members_user_id_idx on public.team_members (user_id);

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists projects_team_id_idx on public.projects (team_id);

-- ---------------------------------------------------------------------------
-- previews — a shareable stable URL backed by an ephemeral tunnel.
--   comment_seq      : monotonic per-preview counter for atomic numbering.
--   access_mode      : team_only (default) vs guest_link.
--   link_secret      : high-entropy guest-link secret (null for team_only).
--   status           : live | offline (driven by heartbeat).
-- ---------------------------------------------------------------------------
create table if not exists public.previews (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects (id) on delete cascade,
  name               text not null default 'Untitled preview',
  slug               text not null unique,
  comment_seq        integer not null default 0,
  access_mode        text not null default 'team_only'
                       check (access_mode in ('team_only', 'guest_link')),
  link_secret        text,
  expires_at         timestamptz,
  status             text not null default 'offline'
                       check (status in ('live', 'offline')),
  current_tunnel_url text,
  last_heartbeat_at  timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists previews_project_id_idx on public.previews (project_id);
-- Unique guest-link lookup (multiple NULLs allowed for team_only previews).
create unique index if not exists previews_link_secret_uq
  on public.previews (link_secret)
  where link_secret is not null;

-- ---------------------------------------------------------------------------
-- participants — a person (member or guest) who has annotated a preview.
--   user_id is the authoritative auth.uid() (anonymous for guests); display
--   name is cosmetic. One participant row per (preview, user).
-- ---------------------------------------------------------------------------
create table if not exists public.participants (
  id           uuid primary key default gen_random_uuid(),
  preview_id   uuid not null references public.previews (id) on delete cascade,
  user_id      uuid references auth.users (id) on delete set null,
  display_name text not null,
  trust_level  text not null check (trust_level in ('member', 'guest')),
  created_at   timestamptz not null default now()
);

create index if not exists participants_preview_id_idx on public.participants (preview_id);
create index if not exists participants_user_id_idx on public.participants (user_id);
-- Upsert key for the write RPCs (one participant per authenticated user/preview).
create unique index if not exists participants_preview_user_uq
  on public.participants (preview_id, user_id)
  where user_id is not null;

-- ---------------------------------------------------------------------------
-- comments — the annotation. `number` is the stable, per-preview, never-reused
-- id allocated atomically inside the write RPCs. `context` holds the captured
-- model-ready context (CapturedContext in the shared schema). `path` records
-- the page path the comment was made on (correlates to a snapshot for offline
-- fidelity; complements context.url).
-- ---------------------------------------------------------------------------
create table if not exists public.comments (
  id                 uuid primary key default gen_random_uuid(),
  preview_id         uuid not null references public.previews (id) on delete cascade,
  number             integer not null,
  author_participant uuid not null references public.participants (id),
  trust_level        text not null check (trust_level in ('member', 'guest')),
  intent             text not null check (intent in ('fix', 'change', 'question')),
  severity           text not null check (severity in ('critical', 'important', 'minor')),
  note               text not null,
  path               text,
  context            jsonb not null default '{}'::jsonb,
  status             text not null default 'open'
                       check (status in ('open', 'resolved', 'dismissed')),
  fidelity           text not null default 'live'
                       check (fidelity in ('live', 'snapshot')),
  resolved_by        uuid references auth.users (id) on delete set null,
  resolved_summary   text,
  created_at         timestamptz not null default now(),
  unique (preview_id, number)
);

create index if not exists comments_preview_id_idx on public.comments (preview_id);
create index if not exists comments_status_idx on public.comments (status);
create index if not exists comments_author_participant_idx on public.comments (author_participant);

-- ---------------------------------------------------------------------------
-- snapshots — SingleFile-style serialized DOM (+ capture-time context) so a
-- page is annotatable offline. Many snapshots per (preview, path) over time;
-- the latest is served when offline.
-- ---------------------------------------------------------------------------
create table if not exists public.snapshots (
  id          uuid primary key default gen_random_uuid(),
  preview_id  uuid not null references public.previews (id) on delete cascade,
  path        text not null,
  payload     jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now()
);

create index if not exists snapshots_preview_id_idx on public.snapshots (preview_id);
create index if not exists snapshots_preview_path_idx on public.snapshots (preview_id, path);

-- ---------------------------------------------------------------------------
-- Role privileges. RLS (0002) — not the absence of grants — is the security
-- boundary, so the standard Supabase client roles get table DML privileges and
-- every row is then gated by policy. Tables with no INSERT policy (e.g. direct
-- comment inserts) are therefore denied by RLS, not by "permission denied".
-- Supabase normally configures these defaults; we set them explicitly so the
-- schema is self-contained and member dashboard reads always work.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete
  on public.teams, public.team_members, public.projects, public.previews,
     public.participants, public.comments, public.snapshots
  to anon, authenticated;

-- Apply the same defaults to any tables added by later migrations.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;

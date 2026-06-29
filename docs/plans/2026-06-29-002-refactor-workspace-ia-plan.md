---
title: "refactor: Workspace IA — Team→Workspace rename + collapse Preview"
type: refactor
status: active
date: 2026-06-29
origin: docs/brainstorms/2026-06-29-workspace-ia-simplification-requirements.md
---

# refactor: Workspace IA — Team→Workspace rename + collapse Preview

## Summary

Rename Team→Workspace across the whole stack in place (preserving live data), auto-create a default workspace on first dashboard load and a default review link per project, remove the manual "Add preview" step, and relabel "preview"→"review link" — so the product reads as **Workspace → Project → (review link + comments)**. The `previews` table and the `access_mode` enum values stay as-is internally (UI relabel only) to protect the just-shipped embedded flow.

---

## Problem Frame

See origin: `docs/brainstorms/2026-06-29-workspace-ia-simplification-requirements.md`. The current Team→Project→Preview shape and tunnel-era "Add preview" step don't match how people think about a collaborative review tool; "Team" is really the workspace and "Preview" is friction.

---

## Requirements

- R1. Team→Workspace renamed everywhere incl. DB (in place, data preserved).
- R2. Workspace = membership/billing/settings boundary; multiple members.
- R3. User-facing hierarchy = Workspace → Project → comments.
- R4. Default workspace auto-created for a new user.
- R5. Creating a project auto-creates one default review link; manual "Add preview" removed.
- R6. Existing review-link-less projects get one backfilled.
- R7. Project page = embed snippet + review/share link + comments; "preview"→"review link" in UI.
- R8. `previews` table kept as the internal review-link unit; embedded flow unaffected except the rename ripple.
- R9. Personas: 1 workspace/N projects; agency = N projects or N workspaces. No "client" entity.

**Origin actors:** A1 workspace owner, A2 workspace member, A3 reviewer.
**Origin flows:** F1 signup→first project, F2 project page, F3 many projects/agency.
**Origin acceptance examples:** AE1 (R4), AE2 (R5), AE3 (R6), AE4 (R1 data preserved), AE5 (R8 embedded still works), AE6 (R1/R7 no "team"/"preview" in UI).

---

## Scope Boundaries

- Keep the `previews` table name and `comments.preview_id`/`review_sessions.preview_id` scoping (collapse preview = auto-create + hide + relabel only).
- Keep the `access_mode` enum values (`team_only`, `guest_link`) in the DB + shared schema; relabel `team_only` in the UI ("Members only"). Renaming the enum value is out of scope (it ripples into the embedded RPCs + CHECK + existing rows).
- No multi-review-link management UI; no Workspace→Team sub-layer; no "client" entity; no billing.
- No behavior change to the embedded `/s` / mint / exchange / overlay beyond the rename ripple.

### Deferred to Follow-Up Work

- Renaming the `access_mode` value `team_only`→`members_only` (DB + shared + code) if desired later.
- A "manage multiple review links per project" UI.

---

## Context & Research

### Relevant Code and Patterns

- DB inventory (live `uuldjrdrlwcgsiuknoor`): tables `teams`, `team_members`, `team_invites`; columns `projects.team_id`, `team_members.team_id`, `team_invites.team_id`; functions referencing team — name-bearing: `create_team`, `is_team_member`, `is_team_owner`, `is_team_owner_or_admin`, `list_team_members`, `accept_team_invite`; body-bearing (call `is_*_team_member` / read team tables): `is_preview_team_member`, `is_project_team_member`, `can_subscribe_preview`, `create_member_comment`, `dismiss_comment`, `resolve_comment`, `claim_next_queue_item`, `finish_queue_item`, `preview_heartbeat`, `preview_offline`, `register_preview_tunnel`, `register_deploy_target`, `mint_review_token`. Policies on `teams/team_members/team_invites/projects/previews/comments/participants/snapshots/comment_queue` reference `is_team_member`/`is_project_team_member`/`is_preview_team_member`/`is_team_owner_or_admin`.
- Code (27 files): `apps/web/lib/{data.ts,auth-guard.ts}`, `apps/web/app/(dashboard)/dashboard/{actions.ts,forms.tsx,page.tsx,previews-form.tsx,projects/[projectId]/page.tsx}`, `apps/web/app/api/previews/route.ts`, etc. Identifiers: `createTeam`/`createTeamAction`/`listTeams`/`TeamRow`/`teamId`/`teamName`/`CreateTeamForm`/`TeamSection`, the RPCs `create_team`/`is_*_team_member`, and table names in `.from('teams'|'team_members')`.
- Migrations: repo has `0001`–`0023` (embedded series + the just-applied live fixes). Next repo number is **`0024`** (rename), **`0025`** (backfill). The live DB also has the hardening migrations (`share_access_gate`, `guest_abuse_hardening`, `team_invites`, `tighten_team_function_grants`) applied — the rename must cover the `team_invites` objects they added.
- Existing bootstrap pattern: `create_team` SECURITY DEFINER RPC (migration 0005) + `apps/web/lib/data.ts createTeam()` — mirror for `create_workspace` + default-workspace bootstrap.

### Institutional Learnings

- RLS helper grants are load-bearing: helpers used in `to authenticated` policies must keep EXECUTE for `authenticated` (see `plans/README.md` + the 0009/0010 history). Re-verify after rename.
- The `previews` table already proven via the live embedded smoke this session — do not disturb its scoping.

---

## Key Technical Decisions

- **In-place `ALTER ... RENAME` for tables/columns/functions.** Postgres RLS policies and FKs reference objects by OID/attnum, so renaming a table/column/function does **not** break dependent policies/FKs — they follow automatically. This preserves all live data and most dependencies for free.
- **Redefine function bodies after the table/column rename.** Function bodies reference `public.teams`/`team_members`/`team_id` by name in their SQL text; after the table/column rename those references are stale, so every team-referencing function must be `CREATE OR REPLACE`d with the new names. Order: (1) rename tables + columns, (2) rename functions (`ALTER FUNCTION … RENAME`, preserves OID so policies follow), (3) `CREATE OR REPLACE` each renamed/affected function body with workspace names + renamed params (`p_team_id`→`p_workspace_id`). Renamed helpers: `is_team_member`→`is_workspace_member`, `is_team_owner`→`is_workspace_owner`, `is_team_owner_or_admin`→`is_workspace_owner_or_admin`, `is_project_team_member`→`is_project_workspace_member`, `is_preview_team_member`→`is_preview_workspace_member`, `list_team_members`→`list_workspace_members`, `create_team`→`create_workspace`, `accept_team_invite`→`accept_workspace_invite`. The embedded RPCs (`mint_review_token`, `register_deploy_target`, etc.) only need their internal `is_preview_team_member(...)` call updated to the new helper name.
- **Keep `previews` table + `access_mode` values.** Bounds blast radius; UI relabels only.
- **Default workspace via app bootstrap, not an auth trigger.** On first dashboard load, if the user has no workspace, call `create_workspace('My Workspace')` (reuses the existing create_team bootstrap pattern; avoids fragile `auth.users` triggers).
- **Default review link on project creation + backfill.** Project creation also inserts one `previews` row (default review link) via the member path; a one-time backfill migration inserts a default review link for existing projects that have none. Default review link: `name='Review link'`, `access_mode='team_only'` (member-safe; user flips to guest link to share externally), slug via `generateSlug()`.

---

## Open Questions

### Resolved During Planning

- access_mode `team_only`: keep the value, relabel UI to "Members only".
- Default-workspace location: app bootstrap on first dashboard load.
- Default review link defaults: name "Review link", `team_only`, generated slug.
- Function param rename `p_team_id`→`p_workspace_id`: yes (via CREATE OR REPLACE — param names are not part of function identity).

### Deferred to Implementation

- Exact `CREATE OR REPLACE` bodies for all ~21 functions (mechanical; copy current def, swap names). Pull each current definition from the live DB (`pg_get_functiondef`) so the redefine matches what's actually deployed (incl. hardening-branch versions), not just the repo files.
- Whether any policy must be dropped+recreated (only if a policy refers to a function/column by a name that ALTER RENAME doesn't carry — expected to be none; verify post-rename that all policies still resolve).
- Backfill query shape for existing projects.

---

## Implementation Units

- U1. **Migration 0024 — Team→Workspace DB rename (in place)**

**Goal:** Rename all team objects to workspace on the live DB, preserving data; embedded flow intact.

**Requirements:** R1, R2, R8

**Dependencies:** None (lands together with U4 code rename)

**Files:**
- Create: `supabase/migrations/0024_rename_team_to_workspace.sql`
- Test: `supabase/tests/workspace_rename.test.sql` (pgTAP: workspaces/workspace_members/workspace_invites exist; teams/team_members gone; is_workspace_member exists; row counts preserved)

**Approach:**
- Order: rename tables (`teams`→`workspaces`, `team_members`→`workspace_members`, `team_invites`→`workspace_invites`) → rename columns (`*.team_id`→`workspace_id`) → `ALTER FUNCTION … RENAME` the 8 name-bearing helpers/RPCs → `CREATE OR REPLACE` every team-referencing function body (pull current defs from the live DB via `pg_get_functiondef` first; swap table/column/param names) → re-verify grants on the renamed helpers (authenticated keeps EXECUTE).
- Author the repo migration file to match; APPLY to the live DB via Supabase MCP `apply_migration`.
- **Verification step (in-unit):** after apply, run an `execute_sql` check that (a) row counts in workspaces/workspace_members/projects/previews/comments equal pre-rename counts, (b) the embedded smoke (mint→establish→create_review_comment→list) still passes in a rolled-back txn, (c) `is_workspace_member` returns true for the dev account on a known workspace.

**Execution note:** Pull each function's live definition before rewriting it; do not assume the repo file matches the deployed (hardening-branch) version.

**Patterns to follow:** RPC house style (SECURITY DEFINER, `set search_path=''`, schema-qualified, grants); the embedded smoke pattern used this session.

**Test scenarios:**
- Covers AE4. Row counts in renamed tables equal pre-migration counts (no data loss).
- Covers AE5. Embedded smoke (mint/establish/create/list) passes post-rename.
- Edge: every RLS policy still resolves (no policy references a dropped name) — query `pg_policy` post-rename.
- Edge: `is_workspace_member`/`is_project_workspace_member`/`is_preview_workspace_member` exist with EXECUTE granted to authenticated; old `is_team_*` names gone.

**Verification:** Live DB renamed, data preserved, embedded smoke green, all policies resolve.

---

- U2. **Migration 0025 — backfill a default review link for existing projects**

**Goal:** Every existing project gets exactly one default review link so the new dashboard works.

**Requirements:** R6

**Dependencies:** U1

**Files:**
- Create: `supabase/migrations/0025_backfill_default_review_links.sql`
- Test: `supabase/tests/backfill_review_links.test.sql`

**Approach:** Insert one `previews` row per project that has zero previews (name "Review link", `team_only`, generated slug — generate server-side, e.g. via a short random string matching `generateSlug`'s alphabet). Idempotent (only for projects with no preview). Apply to live DB; verify each project has ≥1 review link.

**Test scenarios:**
- Covers AE3. A project with no preview gets exactly one after the migration.
- Edge: a project that already has a preview is untouched (no duplicate).

**Verification:** `select count(*) from projects p where not exists (select 1 from previews where project_id=p.id)` returns 0 on the live DB.

---

- U3. **Code rename Team→Workspace (shared + web + cli)**

**Goal:** Rename all code references; tree typechecks against the renamed DB.

**Requirements:** R1, R3

**Dependencies:** U1 (coupled — lands together; a half-renamed tree won't typecheck/run)

**Files:**
- Modify: `apps/web/lib/data.ts` (TeamRow→WorkspaceRow, listTeams→listWorkspaces, createTeam→createWorkspace, `.from('teams'|'team_members')`→workspaces, `team_id`→`workspace_id`, RPC names), `apps/web/lib/auth-guard.ts`, `apps/web/app/(dashboard)/dashboard/{actions.ts,forms.tsx,page.tsx,projects/[projectId]/page.tsx,previews-form.tsx}`, `apps/web/app/api/previews/route.ts`, and the remaining files from the 27-file inventory that reference team identifiers/RPCs/tables.
- Modify: `apps/cli/src/...` (binding/config + mcp/store references to team, if any are functional vs. comments).
- Test: update `apps/web/__tests__/*` that reference team identifiers (e.g. link-management, auth).

**Approach:** Mechanical rename of identifiers + RPC names + table names + the `team_id`→`workspace_id` field. Driven by `pnpm -r typecheck` until clean. Do NOT touch the `access_mode` value `'team_only'` (keep as-is). Many of these files are pre-dirty (dashboard redesign WIP) — edits ride with that WIP; commit only the clean-before files (e.g. `lib/data.ts`, `auth-guard.ts`, `api/previews/route.ts` were clean).

**Test scenarios:**
- Happy path: `pnpm -r typecheck` clean after the rename.
- Covers AE6. No user-facing "team" string remains (grep the dashboard render output / components).
- Integration: dashboard data functions (listWorkspaces/createWorkspace/getProject) call the renamed RPCs/tables and tests pass.

**Verification:** Typecheck clean; web/cli/shared test suites green; no `team`-identifier references remain except the `access_mode` value.

---

- U4. **Auto-create default workspace + default review link**

**Goal:** New users land on "create a project"; creating a project yields a ready review link — no manual workspace/preview steps.

**Requirements:** R4, R5

**Dependencies:** U1, U3

**Files:**
- Modify: `apps/web/lib/data.ts` (default-workspace bootstrap helper; project-create path also creates a default review link), `apps/web/app/(dashboard)/dashboard/page.tsx` (call the bootstrap on load when the user has no workspace), `apps/web/app/(dashboard)/dashboard/actions.ts` (create-project action also creates the default review link)
- Test: `apps/web/__tests__/workspace-bootstrap.test.ts`

**Approach:** On dashboard load, if `listWorkspaces()` is empty, call `create_workspace('My Workspace')`. On project creation, after inserting the project, create one default review link (`previews` row) via the member RPC/insert. Both idempotent.

**Test scenarios:**
- Covers AE1. New user (no workspace) → a default workspace exists after first load.
- Covers AE2. Creating a project → exactly one review link exists; no second step.
- Edge: a user who already has a workspace is not given a second one.

**Verification:** Signup→dashboard shows "create a project"; create project → review link present.

---

- U5. **Dashboard IA + relabel (Workspace / Project / review link)**

**Goal:** The dashboard reads Workspace → Projects → project page (snippet + review link + comments); "team"/"preview" wording gone; no "Add preview" button.

**Requirements:** R3, R5, R7

**Dependencies:** U3, U4

**Files:**
- Modify: `apps/web/app/(dashboard)/dashboard/{page.tsx,forms.tsx,previews-form.tsx,projects/[projectId]/page.tsx}`, `apps/web/app/(dashboard)/dashboard/previews/[previewId]/{page.tsx,link-manager.tsx}` — relabel Team→Workspace, "preview"/"Add preview"→"review link", "Members only" for team_only; project page surfaces the embed snippet + the review link + comments.
- Test: none beyond render-string checks (mostly pre-dirty UI files; copy/label change).

**Approach:** Relabel + remove the manual "Add preview" form (creation is automatic now; keep an optional "add another review link" only if trivial, else drop per scope). These are largely pre-dirty files → edits ride with WIP; commit clean-before ones.

**Test scenarios:**
- Covers AE6. Dashboard shows no "team"/"preview"; shows "Workspace"/"Project"/"review link".

**Verification:** Manual: dashboard reads as Workspace → Projects → project (snippet + link + comments), no "Add preview".

---

## System-Wide Impact

- **Interaction graph:** the rename touches every RLS policy (via renamed helper functions) and every embedded RPC (via `is_preview_workspace_member`); the auth-guard + all dashboard data reads.
- **State lifecycle risks:** live-data rename — must preserve rows; the default-review-link backfill must be idempotent (no duplicates).
- **API surface parity:** member + guest comment paths, queue, heartbeat all call the renamed helpers — all must be redefined in step.
- **Unchanged invariants:** `previews` table + `preview_id` scoping; `access_mode` values; the embedded `/s`/mint/exchange/overlay behavior; comment numbering.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Live-data loss during rename | In-place ALTER RENAME (not drop/recreate) + post-apply row-count verification (AE4) |
| A function body left referencing old `teams`/`team_id` → runtime failure | Pull every current def via `pg_get_functiondef`, redefine all; post-apply embedded smoke (AE5) + dashboard read check |
| RLS helper loses EXECUTE for authenticated after rename | Re-grant + verify EXECUTE post-rename (the 0009/0010 lesson) |
| Half-renamed tree (code vs DB) won't run | U1 (DB) + U3 (code) land together; gate on `pnpm -r typecheck` + a live read |
| Hardening-branch defs differ from repo files | Redefine from the live `pg_get_functiondef`, not the repo migration text |
| Edits land in pre-dirty WIP files | Commit only clean-before files per unit; note the rest ride with WIP |

---

## Documentation / Operational Notes

- Update memory ([[supercomment-overview]], [[build-progress]]) after the rename so future sessions use Workspace terminology.
- Apply 0024 + 0025 to the live DB via Supabase MCP; verify data preserved + embedded smoke before moving on.

---

## Sources & References

- **Origin document:** docs/brainstorms/2026-06-29-workspace-ia-simplification-requirements.md
- Live DB inventory (this session): 3 team tables, 3 team_id columns, ~21 functions, ~30 policies referencing team.
- Embedded plan (prior): docs/plans/2026-06-29-001-feat-embedded-deployed-review-mode-plan.md
- Key code: apps/web/lib/{data.ts,auth-guard.ts}, apps/web/app/(dashboard)/dashboard/*, supabase/migrations/0001_schema.sql + 0005_create_team.sql

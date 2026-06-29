---
date: 2026-06-29
topic: workspace-ia-simplification
---

# SuperComment — Workspace IA Simplification

## Summary

Collapse SuperComment's org model from **Team → Project → Preview** to a standard **Workspace → Project** shape: rename Team→Workspace everywhere (including the database, preserving data), auto-create a default workspace on signup, and make each project auto-own one default "review link" so the manual "Add preview" step disappears. The `previews` table stays as the internal review-link unit; only the user-facing concept and labels change.

---

## Problem Frame

The current hierarchy is four levels — Team → Project → Preview → Comments — and the labels don't match how people think about a collaborative review tool. "Team" is really the workspace (membership/billing boundary), and "Preview" is a tunnel-era artifact: the dashboard forces users to manually "Add preview" to get a share link (see the project page: *"No previews yet — add one to get a stable link"*). A developer's mental model is "create a project, get a snippet, paste it, collect comments" — the extra layers and the tunnel-era naming read as clutter and friction. Standard collaborative SaaS (Linear, Vercel, Figma) puts membership at a **Workspace/Org** and work under **Projects**; SuperComment should match that.

---

## Actors

- A1. Workspace owner — the developer who signs up; creates projects, gets the snippet + review link, reads comments.
- A2. Workspace member — an invited teammate who shares the workspace's projects.
- A3. Reviewer — guest or member who comments via a project's review link (downstream of this change; unaffected mechanically).

---

## Key Flows

- F1. Signup → first project
  - **Trigger:** A new user signs up.
  - **Actors:** A1
  - **Steps:** A default workspace is auto-created → the user lands on "create a project" → on creating a project they get the embed snippet + the project's review link.
  - **Outcome:** A solo user never manually creates a workspace or a preview.
  - **Covered by:** R3, R4, R5, R7

- F2. Project page
  - **Trigger:** A1 opens a project.
  - **Actors:** A1
  - **Steps:** The page shows the embed snippet, the project's review/share link, and the comment thread — no "Add preview" step.
  - **Outcome:** Project → snippet → link → comments, in one place.
  - **Covered by:** R5, R7

- F3. Many projects / agency
  - **Trigger:** An agency manages multiple clients.
  - **Actors:** A1, A2
  - **Steps:** Create one project per client/site in a single workspace; or create a separate workspace per client when billing/access isolation is needed.
  - **Outcome:** Multi-client work without a dedicated "client" entity.
  - **Covered by:** R2, R9

---

## Requirements

**Rename (Team → Workspace)**
- R1. Rename Team→Workspace across the whole stack — DB tables (`teams`→`workspaces`, `team_members`→`workspace_members`), columns (`projects.team_id`→`workspace_id`), helper/RPC names (`create_team`→`create_workspace`, `is_team_member`→`is_workspace_member`, `is_project_team_member`→`is_project_workspace_member`, `list_team_members`→`list_workspace_members`), RLS policies, and every web/CLI/shared reference + UI label. Existing data must be preserved (in-place rename, not drop/recreate).
- R2. A workspace is the membership + (future) billing + settings boundary; multiple users belong to it (`workspace_members`).

**Hierarchy & defaults**
- R3. The user-facing hierarchy is Workspace → Project → comments. No separate "team" or "preview" level is surfaced.
- R4. A default workspace is auto-created for a new user so they land directly on "create a project."
- R5. Creating a project auto-creates exactly one default review link (internally a `previews` row); the manual "Add preview" step is removed.
- R6. Existing projects that have no review link get one backfilled, so current data works under the new dashboard.
- R7. The project page presents the embed snippet, the project's review/share link, and the comment thread; "preview" is relabeled "review link" in the UI.

**Boundaries kept**
- R8. The `previews` table remains the internal per-review-link unit; the just-shipped embedded flow (mint/exchange/`create_review_comment`/`list_review_comments`/`/s` route/overlay) is unaffected except for the team→workspace rename ripple. A project may hold multiple review links later; the UI defaults to one.
- R9. Personas served with no new entities: product company = 1 workspace, many projects; agency = 1 workspace with many per-client projects, or separate workspaces for isolation.

---

## Acceptance Examples

- AE1. **Covers R4.** Given a brand-new user signs up, when they reach the dashboard, a default workspace already exists and they see "create a project" — no manual workspace step.
- AE2. **Covers R5.** Given a user creates a project, when the project page loads, exactly one review link exists and there is no "Add preview" button.
- AE3. **Covers R6.** Given an existing project with no preview row, when the migration runs, it has one default review link afterward.
- AE4. **Covers R1.** Given existing `teams`/`team_members`/`projects`/`previews`/`comments` data, when the rename migration runs, all rows are intact (no data loss) and dashboard reads still work.
- AE5. **Covers R8.** Given the embedded review flow, when a reviewer activates a link and comments after the rename, mint→exchange→`create_review_comment`→`list_review_comments` all still succeed.
- AE6. **Covers R1, R7.** Given the renamed UI, when a user browses the dashboard, the words "team" and "preview" do not appear; "Workspace", "Project", and "review link" do.

---

## Success Criteria

- A solo user goes signup → create project → copy snippet with no "team" or "preview" steps in the way.
- All existing live data is preserved through the rename, and the embedded review flow still works end-to-end.
- "Team" and "preview" are gone from the user-facing product; the model reads as Workspace → Project → (review link + comments).
- ce-plan can derive the migration sequence and code changes without inventing product behavior.

---

## Scope Boundaries

- Do **not** remove or internally rename the `previews` table, and do **not** rescope comments/sessions from preview→project — that would rewrite the just-shipped embedded mode. "Collapse preview" is auto-create + hide + relabel only.
- No multi-review-link management UI (a project can have several internally; the UI surfaces one default for now).
- No Workspace→Team sub-layer and no dedicated "client" entity (agencies use projects or separate workspaces).
- No billing implementation (workspace is the future billing boundary; not built here).
- No change to the embedded `/s` / mint / exchange / overlay behavior beyond the mechanical team→workspace rename.

---

## Key Decisions

- **Rename in place (ALTER … RENAME), not new-tables-and-copy** — preserves the live DB's existing rows and keeps dependent FKs/policies attached; avoids a data-copy migration.
- **Keep `previews` as the internal unit; relabel to "review link" in the UI only** — protects the embedded RPCs/route/overlay built on `preview_id` from a churny, risky internal rename.
- **Auto-create default workspace (on signup) + default review link (on project creation), and backfill existing projects** — removes the manual workspace/preview steps for the common case while keeping current data working.
- **"Review link" is the user-facing term** for what is internally a `previews` row.

---

## Dependencies / Assumptions

- The live Supabase DB (`uuldjrdrlwcgsiuknoor`) holds real data in teams/team_members/projects/previews/comments; the rename runs against it via Supabase MCP and must preserve that data.
- This change layers on the just-committed embedded-mode work and significant pre-existing uncommitted WIP in the working tree; the rename will touch pre-dirty files.
- The DB rename ripples into helper functions used by the embedded RPCs (e.g. `is_preview_team_member` reads `team_members`); those must be updated in step.

---

## Outstanding Questions

### Resolve Before Planning

- (none — product decisions are settled; the items below are implementation questions for planning)

### Deferred to Planning

- [Affects R1][Technical] Exact rename-migration mechanics and ordering on the live DB (rename tables/columns, then recreate/redefine the functions that reference them, then policies), including whether to rename function parameter names (`p_team_id`→`p_workspace_id`) and how this interacts with the hardening migrations' team functions already applied.
- [Affects R4][Technical] Where default-workspace-on-signup lives (a DB trigger on auth.users vs. app-side bootstrap on first dashboard load) and how it composes with the renamed `create_workspace` bootstrap.
- [Affects R5, R6][Technical] The auto-create-default-review-link mechanism (on project insert) and the backfill query for existing projects; what the default review link's name/slug/access_mode defaults are.
- [Affects R7][Needs decision in planning] Final user-facing term ("review link" vs "share link") and the project-page layout for snippet + link + comments.

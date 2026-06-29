---
date: 2026-06-28
topic: embedded-deployed-review-mode
---

# SuperComment — Embedded Deployed Review Mode

## Summary

Build SuperComment's "deployed" mode: an embedded overlay that lives in the developer's *own* deployed preview/staging build (not the localhost tunnel), so a shared review link stays live and fully interactive after the developer goes offline. Reviewers click a link and the toolbar auto-appears; comments persist across redeploys and carry code context for AI-agent hand-off. Tunnel mode is retained but dormant.

---

## Problem Frame

Today SuperComment shares a localhost preview via a Cloudflare quick tunnel plus a stable `/s/<slug>` reverse-proxy link. When the developer's machine or dev server goes offline, the heartbeat stops, the preview flips to `offline`, and `/s/<slug>` returns a 503 — the link is dead. A static DOM snapshot was considered as the offline fallback, but it freezes JavaScript, interactions, and backend-connected behavior, and interactivity is exactly what reviewers need to annotate.

The people affected: a developer who wants feedback on in-progress work, and a reviewer (often non-technical — a PM, designer, or client) who must be able to open one link and review a real, working app without installing or running anything. The cost of the status quo is that review is gated on the developer keeping a process alive on their laptop, and the richest feedback (mid-interaction, backend-driven states) can't be reliably captured or replayed.

The competitive landscape (researched 2026-06-28) shows native preview-commenting on Vercel/Netlify is account-gated or positional, with no code context and no AI hand-off; the closest agent-native tool (FasterFixes) is React-only, developer-positioned, and not platform-agnostic. The whitespace is a platform-agnostic, non-developer-reviewer-first tool that attaches real code context and routes to an AI coding agent.

---

## Actors

- A1. Developer: installs the overlay into their deployed preview build, creates/share review links, reads comments, and hands them to an AI agent or fixes them directly.
- A2. Team-member reviewer: a logged-in SuperComment user who reviews a preview; comments are attributed to their identity.
- A3. Guest reviewer: a non-account visitor (PM/designer/client) admitted via a link secret; reviews and comments with zero setup.
- A4. AI coding agent: Claude Code / Cursor / other; receives a comment plus code context and implements the fix.

---

## Key Flows

- F1. One-time install
  - **Trigger:** Developer wants persistent, always-on review for a project.
  - **Actors:** A1
  - **Steps:** Add the universal SuperComment script to the app, gated to non-production builds; optionally add the per-framework build plugin for exact `file:line`; deploy preview/staging as usual.
  - **Outcome:** Every future preview build carries the overlay, dormant until a review link activates it.
  - **Covered by:** R1, R2, R9, R18

- F2. Share and activate a review
  - **Trigger:** Developer wants feedback on a deployed preview.
  - **Actors:** A1, A2, A3
  - **Steps:** Developer creates/sends a `/s/<slug>` link → reviewer clicks → SuperComment resolves identity first-party and redirects to the deployed app with a short-lived token → the embedded overlay validates it, establishes a review-scoped session, persists it for navigation, and strips the token from the URL → toolbar appears.
  - **Outcome:** Reviewer is in the live app with the toolbar, recognized as team member or guest, having done nothing but click.
  - **Covered by:** R3, R4, R5, R6, R7

- F3. Comment with code context and hand off
  - **Trigger:** Reviewer sees something to flag.
  - **Actors:** A2/A3, then A1, then A4
  - **Steps:** Reviewer selects an element / interaction and comments → overlay captures live code context (and `file:line` if the plugin is present) + a screenshot → developer reviews it in the dashboard → hands it to an AI agent with context attached, or fixes it directly.
  - **Outcome:** A fix is implemented from precise, element-anchored, code-aware feedback.
  - **Covered by:** R8, R9, R10, R11, R15

- F4. Redeploy and reconcile
  - **Trigger:** Developer pushes a change; the preview redeploys.
  - **Actors:** A1, A2/A3
  - **Steps:** Reviewer refreshes → existing comments re-anchor to their elements on the new deploy → each comment shows its capture-time screenshot as "before" → comments whose elements are gone are marked stale but remain → reviewer marks addressed comments done.
  - **Outcome:** A continuous review thread survives redeploys with before/after context; nothing is silently lost.
  - **Covered by:** R12, R13, R14, R15, R16

---

## Requirements

**Delivery & activation**
- R1. The overlay is delivered as an embedded script in the developer's own deployed preview/staging build, running on the app's own origin so auth, cookies, websockets, and backend calls work natively.
- R2. The overlay stays dormant (invisible and inert) unless a valid review session is active; it never auto-shows for ordinary visitors.
- R3. A `/s/<slug>` share link activates a review by redirecting to the deployed app carrying a short-lived token; the embedded overlay validates the token, establishes a review-scoped session, persists it across in-app navigation, and removes the token from the visible URL.
- R4. The reviewer performs no setup — no install, no command, no manual token entry.

**Identity & access**
- R5. Identity is resolved first-party at the share-link hop: a logged-in team member is recognized as themselves and their comments are attributed to them; a visitor without an account is admitted as a guest scoped by the link secret.
- R6. `team_only` reviews require login before activation; `guest_link` reviews admit guests via the link secret. One link auto-detects which path applies.
- R7. Guest sessions are scoped to the specific review and honor the existing expiry and secret-rotation controls.

**Code context & AI hand-off**
- R8. Every comment captures the richest available live code context for the targeted element (component path, selector, computed styles, surrounding markup, console errors), captured against the real running app (the highest-fidelity tier).
- R9. Two install paths coexist: a universal script tag (always-on floor, any framework/host) and an optional per-framework build plugin that adds exact `file:line` source precision as progressive enhancement — the overlay uses it when present and falls back gracefully when absent.
- R10. The dashboard exposes an "enhanced code context" capability per project that auto-detects whether `file:line` precision is active, shows one-time setup steps, and gates whether `file:line` is included in AI hand-offs.
- R11. The developer can review a comment with its full context in the dashboard and hand it to an AI coding agent with that context attached; the existing hand-off path carries over.

**Comment lifecycle & redeploys**
- R12. Comments persist across redeploys; they are never discarded because the deployment changed.
- R13. On a new deploy, a comment re-anchors to its target element via the multi-anchor system; if the element cannot be found, the comment is marked stale but remains visible.
- R14. Each comment records provenance at creation: the deployment/commit it was made against, plus its captured context.
- R15. Each comment displays its capture-time screenshot as a "before" reference, enabling a before/after comparison against the current state for both reviewer and developer.
- R16. Comments remain in the active list until explicitly marked done (resolved), extending the existing comment lifecycle/status controls.

**Tunnel deprecation & production safety**
- R17. Tunnel mode is disabled (its entry path un-wired behind a flag) but its code is retained intact for later re-enablement; nothing tunnel-specific is deleted.
- R18. The overlay never activates for production end-users: it is excluded from production builds at build-time and is inert without a valid review token at runtime.

---

## Acceptance Examples

- AE1. **Covers R2, R18.** Given a deployed preview with the snippet present, when an ordinary visitor opens the app URL with no review token, the overlay stays dormant and no toolbar appears.
- AE2. **Covers R3, R4, R5.** Given a guest clicks a `guest_link` share link, when the page loads, the toolbar auto-appears, the token is removed from the URL, and the guest can comment without an account.
- AE3. **Covers R5.** Given a logged-in team member clicks the same review link, when the page loads, they are recognized as themselves and their comments are attributed to their identity.
- AE4. **Covers R6.** Given a `team_only` review, when a visitor without a session opens the link, they are sent to login before the overlay activates.
- AE5. **Covers R12, R13, R15.** Given a comment exists on deploy A, when the developer redeploys to deploy B and the element still exists, the comment re-anchors to it and shows the deploy-A screenshot as "before."
- AE6. **Covers R13.** Given a comment whose target element is removed in deploy B, when the review is viewed, the comment is marked stale but remains visible with its captured context.
- AE7. **Covers R9, R10.** Given the optional build plugin is not installed, when a comment is captured, code context falls back to component path/selector and the dashboard shows enhanced context as "not detected."
- AE8. **Covers R16.** Given an active comment, when the developer marks it done, it leaves the active list and enters the resolved state.

---

## Success Criteria

- A non-technical reviewer can open a shared link and leave an element-anchored comment on a fully interactive deployed preview, with zero setup, and the link works after the developer's machine is offline.
- The developer can act on a comment — directly or via an AI agent — with enough code context to locate the relevant component/code quickly; with the plugin installed the agent receives exact `file:line`.
- Comments survive redeploys with before/after context and an explicit done state; nothing is silently lost or duplicated.
- ce-plan can derive the implementation without inventing product behavior: activation, identity, lifecycle, install paths, and gating are all specified.

---

## Scope Boundaries

- Re-enabling or building new tunnel functionality — kept dormant for later.
- Static-snapshot-only offline serving as the primary path — superseded by the live embedded model; the snapshot system is retained only as the before-state backup.
- Non-React framework build plugins at launch — the universal script tag still covers them at lower fidelity.
- SuperComment hosting the customer's app or infrastructure (the "host their environment" options) — we overlay on their own deploy; we do not run it.
- Browser-extension delivery.
- Production end-user-facing feedback collection.
- New third-party issue-tracker integrations (Jira/Linear/etc.).

---

## Key Decisions

- Embedded snippet over reverse-proxy injection for the live model: the app must run on its own origin so auth/cookies/realtime work; proxying breaks these for a real product.
- Redirect-with-token over proxy for `/s/<slug>` in embedded mode: resolving identity first-party at the hop avoids third-party-cookie blocking and keeps the app on its own origin.
- Progressive enhancement for code context: universal script-tag floor + optional plugin for `file:line` — preserves the platform-agnostic wedge while enabling premium fidelity, surfaced/controlled from the dashboard.
- Reuse the existing direct-to-Supabase comment submission with the review token wrapping the link secret, rather than building a new cross-origin API surface (lean — ce-plan to finalize).
- Hybrid comment persistence (re-anchor + provenance + screenshot) over pin-to-deploy or pure-float: one continuous thread while preserving per-comment version context for the AI and a built-in before/after.

---

## Dependencies / Assumptions

- Target users have (or can create) an always-on deployed preview/staging environment; this model does not serve users with nothing deployed (that is the tunnel's future role).
- Supabase continues to accept cross-origin browser calls for the guest comment path.
- Reliable in-browser raster screenshots are best-effort; the existing DOM-snapshot system backs the before-state.
- The differentiation (platform-agnostic injection, non-developer reviewer with code context, AI-first hand-off) must be actively defended against fast-moving competitors (FasterFixes is closest). See `docs/brainstorms/2026-05-30-supercomment-team-visual-feedback-requirements.md` for the original product framing.

---

## Outstanding Questions

### Resolve Before Planning

- (none — product decisions are resolved; the items below are implementation questions for planning)

### Deferred to Planning

- [Affects R3, R5][Technical] Exact token format, lifetime, and session-exchange mechanism (link token → review-scoped session).
- [Affects R9][Technical] Whether `file:line` comes from a stamped data attribute, framework source annotations, or both, and how the overlay reads it on a production-mode preview build.
- [Affects R14][Technical] How the current deploy/commit is determined and recorded as provenance (CI registration vs runtime detection) and how a review target URL is registered/updated.
- [Affects R8, R11][Technical] Final comment-submission transport (direct-to-Supabase vs new API) and any CORS handling.
- [Affects R17][Technical] The precise flag/seam used to disable the tunnel entry path while retaining its code.
- [Affects R15][Needs research] Best-effort screenshot approach and the fallback to a DOM snapshot for the before-state.

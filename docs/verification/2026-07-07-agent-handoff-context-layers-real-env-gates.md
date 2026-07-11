---
date: 2026-07-07
topic: agent-handoff-context-layers
unit: U10 (late real-env gates)
---

# Agent hand-off context layers — real-env verification runbook

Manual real-env gates for the agent-handoff-context-layers feature
(`docs/plans/2026-07-07-001-feat-agent-handoff-context-layers-plan.md`, U10).
Exercises the live Supabase project (`uuldjrdrlwcgsiuknoor`, migrations through
`0045_resolve_comment_prompt_scrub`) directly through the real
`SupabaseCommentStore` / `registerTools` / repo-discovery modules, with a real
signed-in member access token (password grant) — the paths the in-memory unit
tests cannot cover: RLS, the signed-URL round trip, and the live send/prompt
RPCs.

Driver script: `scripts/verify-agent-handoff-live.mts` (committed, matching
the other real-env harnesses under `scripts/`; not required to reproduce this
result, but left in place for re-runs). Run from the repo root:

```
SC_MEMBER_TOKEN_PATH=<path to a JSON file with a fresh {"access_token": "..."}> \
  arch -arm64 node_modules/.bin/tsx scripts/verify-agent-handoff-live.mts
```

The access token is minted headless via the password grant against the dev
account (`jkbnsefkd@gmail.com`), per the `running-setup` memory. `arch -arm64`
is required on this machine (Rosetta/rollup native-binary mismatch otherwise).

## Fixtures

Created directly via SQL against the live DB, in preview `89c36382-8c31-445d-82ff-c265b0193014`
("Personal website", the dev account's own workspace, `can_send_to_agent=true`):

- Comment **#37** (id `2eff152c-3168-489d-a43b-17ee94921fed`), guest-authored
  (`trust_level='guest'`), `context.referenceImages` pointing at a real,
  pre-existing `captures` bucket object
  (`89c36382-8c31-445d-82ff-c265b0193014/eaaf7eb1-98e0-4730-b351-af570af4fa02.png`,
  reused rather than uploading a new binary — simpler and equally real).
  Used for Gates 1 and 2 (sequenced on the same comment, per the plan's
  "or the same one before you confirm it, sequenced correctly").
- Comment **#38** (id `f90bbe87-bef7-4dd6-b047-c9687a58ab36`), member-authored
  (`trust_level='member'`), plain context, no reference image. Used for
  Gates 3 and 4.
- Gate 5 uses a second, real, pre-existing preview id
  (`3fb218bf-4d32-4f70-bb24-cbc6642e7958`, the "smoke" preview from a
  different project) purely as a differently-anchored previewId argument —
  no fixture needed there, `discover()` is a pure lookup.

## Results

| Gate | Steps | Result | Evidence |
|---|---|---|---|
| 1 — signed reference actually opens for the agent | Confirmed the guest send (`send_comment_to_agent(#37, confirm=true)`) as the member; ran `SupabaseCommentStore.getComment(37)` with a real member-authenticated client; fetched the returned reference URL directly | PASS | `getComment` returned `context.referenceImages[0]` as `https://uuldjrdrlwcgsiuknoor.supabase.co/storage/v1/object/sign/captures/...`; a direct `fetch()` of that URL returned `200` with `content-type: image/png` |
| 2 — confirmed vs unconfirmed guest reference end-to-end | On the SAME comment #37: ran `handleGetComment` (the actual tool-layer handler, not the raw store — stripping is a `tools.ts` concern) BEFORE any confirm, then confirmed the send, then ran `handleGetComment`/`getComment` again | PASS | Before confirm: `context` keys were `["url","surface","selector"]` — `referenceImages` absent entirely (not a raw path, not a URL). After confirm: resolved to the same signed URL as Gate 1 |
| 3 — per-send prompt snapshot fidelity | `set_agent_prompt(#38, "U10-GATE3-DISTINCTIVE-PROMPT-<timestamp>")` as the member; `send_comment_to_agent(#38, confirm=false)` on a fresh cycle (no prior active queue row); read `comment_queue.prompt_snapshot` back directly via SQL | PASS | `prompt_snapshot` exactly equalled the distinctive prompt text written moments before (`U10-GATE3-DISTINCTIVE-PROMPT-1783417550583`), byte-for-byte |
| 4 — standing guidance + maturity discovery against a real repo | (a) `computeRepoDiscovery(repoRoot)` against this repo's real root (`/Users/guestos/.superset/projects/supercomment`); (b) `registerTools` wired against a real `buildRepoDiscoverySeam` anchored to that root + preview `89c36382-...`, using a fake `McpServerLike` (the same fake pattern `tools.test.ts` uses) to capture the registered `get_comment` description and its handler output for comment #38 | PASS | (a) returned `{governanceDocs: [], maturity: "thin"}` exactly as expected (this repo genuinely has no `AGENTS.md`/`CLAUDE.md`/`docs/design-guidelines.md`/`DESIGN.md`/`CONTRIBUTING.md` at root and no `tailwind.config.*`/`tokens.json`/`components/ui` at root — confirmed by `ls` ahead of the run); (b) the `get_comment` tool's registered `description` contained the full `STANDING_GUIDANCE` text, and the handler's output envelope carried `designGrounding: {source: null, selector: "div.test-fixture", maturity: "thin", guidance: <thin-variant text>}` |
| 5 — `use_project` switch degrades to defaults | Called `discoverySeam.discover(<a different real previewId, 3fb218bf-...>)` directly (the seam anchored to preview `89c36382-...` in Gate 4) | PASS | Returned `{governanceDocs: [], maturity: "indeterminate"}` — exactly `DEGRADED_RESULT`, not the launch-cwd repo's real (thin) result, proving a preview switch away from the anchored repo degrades rather than misdescribing the new preview as belonging to this repo |

All 5 gates: **PASS**. No real bugs found — one round of test-harness
corrections was needed along the way (see Notes below), not product defects.

## Notes / test-harness corrections (not product bugs)

Two assertions in the driver script were wrong on the first pass and were
corrected before the final run above; both were verification-methodology
mistakes, not defects in `apps/cli/src/mcp/*`:

1. Gate 2's "stripped before confirm" check initially called
   `SupabaseCommentStore.getComment()` directly and expected the raw
   `context.referenceImages` field to be absent. It was still present (as
   the raw bucket path) — correctly so: the store's job is only to decide
   whether a raster is worth *resolving* (`shouldResolveRaster`); stripping
   an unconfirmed guest raster is `tools.ts`'s `forAgent` responsibility,
   documented explicitly in both functions' doc comments. Fixed by routing
   through `handleGetComment` (the real tool-layer handler) instead, which
   correctly stripped the field.
2. The initial `designGrounding` assertion looked for
   `comment.designGrounding` (nested). The actual (and correctly documented)
   shape puts `designGrounding` on the output envelope, a sibling of
   `comment`, not nested inside it (`attachDesignGrounding` in `tools.ts`).
   Fixed the assertion path; behavior was already correct.

## Cleanup

Performed. All fixture rows were deleted at the end of the run:

```sql
delete from comments where id in (
  '2eff152c-3168-489d-a43b-17ee94921fed', -- #37
  'f90bbe87-bef7-4dd6-b047-c9687a58ab36'  -- #38
);
```

`agent_prompts`, `agent_reference_confirmations`, and `comment_queue` rows for
both comments cascade-deleted (`on delete cascade` FKs to `comments`) —
verified zero remaining rows in all four tables after the delete. No new
Storage objects were created (an existing real `captures` object was reused
for signing, never mutated). The scratch member-token file (session
scratchpad, outside the repo) was deleted after the run. No other tables or
rows were touched; the pre-existing dev-account data (e.g. comments #1-#36)
was not read-write except for read-only SELECTs.

-- =============================================================================
-- 0045_resolve_comment_prompt_scrub.sql — resolve-summary/prompt overlap guard (U6)
-- =============================================================================
-- R9: a workspace member's private prompt (agent_prompts, 0043) must never
-- reach a guest reviewer. `agent_prompts` itself is safely member-only (RLS,
-- no realtime publication membership, U13's handoff_privacy.test.sql proves
-- it) -- but `resolved_summary` is a plain column on `comments`, which DOES
-- ride the comments-row realtime broadcast (0004) that guests subscribe to.
-- If an agent (or a member) resolves a comment with a summary that closely
-- echoes the live prompt -- verbatim, or only differing in case/whitespace --
-- that prompt text would ride the broadcast wire under a completely
-- different, unguarded column. This migration closes that one specific leak
-- path inside `resolve_comment`, `create or replace`-ing the SAME signature
-- and return shape defined in 0024 (additive logic inside the existing body,
-- not a new function; grants below restate 0024's exact grant set since
-- CREATE OR REPLACE does not need it but this stays self-documenting).
--
-- Mechanism: before writing `p_summary` into `resolved_summary`, look up the
-- comment's live prompt (SECURITY DEFINER lets this function read
-- `agent_prompts` directly regardless of the caller's own RLS visibility). If
-- one exists, normalize BOTH the prompt body and the summary the same way
-- (lowercase + collapse whitespace runs to a single space), split the
-- normalized prompt into lines (its natural "meaningful chunk" boundary), and
-- drop any chunk under 15 normalized characters -- a short line ("ok", "fix
-- this") would false-positive against almost any summary and isn't the kind
-- of leak this guards against. If ANY remaining chunk appears as a substring
-- of the normalized summary, treat it as an overlap.
--
-- On overlap: BLANK `resolved_summary` to NULL -- not a placeholder string,
-- and not a raised exception:
--   * NOT an exception: resolving the comment is a legitimate action that
--     should succeed even when the agent's summary happens to closely
--     paraphrase the private instruction it was given; only the leaking TEXT
--     is withheld, never the resolve itself.
--   * NOT a placeholder string (e.g. "(withheld)"): a placeholder would ITSELF
--     be a small leak -- it tells any reviewer who can read resolved_summary
--     (guests included, via the same broadcast) that a private prompt exists
--     and was redacted here, which is metadata this feature otherwise never
--     exposes (R9 is "never visible", not "visible-but-marked-hidden"). NULL
--     is indistinguishable from "no summary was ever recorded", the exact
--     shape a guest already sees for the common case of a resolve with no
--     summary at all -- the conservative, no-new-signal choice.
--
-- Semantic paraphrase (a summary that describes the same fix in materially
-- different words) is an accepted residual, not solved here -- documented in
-- the plan's Risks. This guard catches literal/near-literal echoes riding the
-- wire under the wrong column, which is the concrete, checkable leak.
--
-- REAL-ENV GATE: validated in a ROLLED-BACK transaction with role
-- impersonation (a workspace member resolving a comment that has a live
-- agent_prompts row, both an overlapping and a non-overlapping summary, and a
-- comment with no live prompt at all) BEFORE apply; get_advisors(security)
-- run after apply with no new errors.
-- =============================================================================

create or replace function public.resolve_comment(p_comment_id uuid, p_summary text)
returns public.comments
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_preview      uuid;
  v_comment      public.comments%rowtype;
  v_summary      text := p_summary;
  v_prompt_body  text;
  v_norm_summary text;
  v_line         text;
  v_chunk        text;
  c_min_chunk_len constant integer := 15;
begin
  select preview_id into v_preview from public.comments where id = p_comment_id;
  if v_preview is null then raise exception 'comment_not_found' using errcode = 'P0001'; end if;
  if not public.is_preview_workspace_member(v_preview) then raise exception 'not_authorized' using errcode = '42501'; end if;

  -- R9 scrub: only bother normalizing/comparing when there is a non-blank
  -- summary AND a live prompt to compare it against; the overwhelmingly
  -- common case (no prompt on this comment at all) exits here with zero
  -- behavior change from the pre-U6 function.
  if v_summary is not null and btrim(v_summary) <> '' then
    select body into v_prompt_body from public.agent_prompts where comment_id = p_comment_id;
    if v_prompt_body is not null then
      v_norm_summary := lower(regexp_replace(v_summary, '\s+', ' ', 'g'));
      for v_line in
        select unnest(string_to_array(v_prompt_body, chr(10)))
      loop
        v_chunk := lower(btrim(regexp_replace(v_line, '\s+', ' ', 'g')));
        if length(v_chunk) >= c_min_chunk_len and position(v_chunk in v_norm_summary) > 0 then
          v_summary := null;
          exit;
        end if;
      end loop;
    end if;
  end if;

  update public.comments set status = 'resolved', resolved_by = (select auth.uid()), resolved_summary = v_summary
   where id = p_comment_id returning * into v_comment;
  return v_comment;
end;
$fn$;

-- Restate 0024's exact grant set for this signature (CREATE OR REPLACE does
-- not reset existing grants, but this keeps the migration self-documenting).
revoke all on function public.resolve_comment(uuid, text) from public;
grant execute on function public.resolve_comment(uuid, text) to anon, authenticated, service_role;

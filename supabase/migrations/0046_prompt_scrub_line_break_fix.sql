-- =============================================================================
-- 0046_prompt_scrub_line_break_fix.sql — R9 scrub: fix line-break/short-line
-- bypass, and extend the guard to dismiss_comment (code review findings)
-- =============================================================================
-- 0045 introduced a resolve_comment guard that scrubs resolved_summary when it
-- overlaps the comment's live private prompt (agent_prompts, 0043) -- because
-- resolved_summary rides the comments-row realtime broadcast that guests
-- subscribe to, and the prompt must never reach a guest by that path.
--
-- That guard split the prompt on newlines and checked EACH LINE independently,
-- dropping any line under 15 normalized characters. Three independent code
-- reviewers (testing, security, adversarial) confirmed this has two concrete
-- bypasses:
--   1. A prompt whose sensitive content straddles a line break (e.g. "skip the
--      check\nfor null user") never forms one complete per-line chunk, so a
--      summary that echoes the sentence verbatim (with the line break replaced
--      by a space, as any prose summary naturally would) sails through
--      unmatched.
--   2. A single short line/prompt under 15 chars (e.g. "hide auth bug", 13
--      chars) was exempted entirely, even though it's a distinctive, sensitive
--      instruction, not the kind of trivial filler ("ok", "done") the
--      threshold was meant to exempt.
--
-- Fix: stop chunking by LINE at all. Flatten the prompt (collapse all
-- whitespace, including newlines, to single spaces) into ONE normalized
-- string, then slide a fixed-size window (20 chars, stepped by 8, so
-- consecutive windows overlap) across it and check each window as a substring
-- of the normalized summary -- this catches a verbatim run of the prompt
-- regardless of where its original line breaks were. A prompt short enough to
-- fit in one window is checked whole (with a lower 8-char floor, catching
-- "hide auth bug"-shaped content while still exempting truly trivial
-- filler like "ok"). This remains a heuristic, not a guarantee -- an
-- adversarially-reworded (semantic paraphrase) echo is still an accepted
-- residual per the original design; this fix closes the MECHANICAL bypasses
-- the reviewers found, not that one.
--
-- Also: 0045 only patched resolve_comment. dismiss_comment writes p_reason
-- into the SAME resolved_summary column via the SAME broadcast-reachable
-- path, and had no scrub at all -- a symmetric gap a fourth reviewer
-- (correctness) found. Both RPCs now share ONE scrub function
-- (scrub_prompt_overlap) so there is a single guard to get right, not two
-- copies that could drift.
--
-- scrub_prompt_overlap is NOT granted to authenticated (or anyone): it is only
-- ever invoked from within resolve_comment/dismiss_comment, which are
-- themselves SECURITY DEFINER, so the nested call executes under the
-- definer's context -- no separate client-facing grant is needed or wanted.
--
-- REAL-ENV GATE: validated in a ROLLED-BACK transaction (both mechanical
-- bypass cases fixed; the existing verbatim/no-overlap/no-prompt cases from
-- 0045's own scenarios still pass; the new dismiss_comment scrub proven
-- symmetric to resolve_comment's) BEFORE apply; get_advisors(security) after.
-- =============================================================================

create or replace function public.scrub_prompt_overlap(p_comment_id uuid, p_text text)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_text           text := p_text;
  v_prompt_body    text;
  v_norm_text      text;
  v_norm_prompt    text;
  v_window         text;
  v_pos            integer;
  v_overlap        boolean := false;
  c_window_len constant integer := 20;
  c_step       constant integer := 8;
  c_min_check_len constant integer := 8;
begin
  if v_text is null or btrim(v_text) = '' then
    return v_text;
  end if;

  select body into v_prompt_body from public.agent_prompts where comment_id = p_comment_id;
  if v_prompt_body is null then
    return v_text;
  end if;

  v_norm_text := lower(regexp_replace(v_text, '\s+', ' ', 'g'));
  v_norm_prompt := lower(btrim(regexp_replace(v_prompt_body, '\s+', ' ', 'g')));

  if length(v_norm_prompt) <= c_window_len then
    -- The whole (short) prompt is the only meaningful chunk. Below the
    -- floor, treat it as too generic to check (avoids false-positives on
    -- trivial filler like "ok").
    if length(v_norm_prompt) >= c_min_check_len
       and position(v_norm_prompt in v_norm_text) > 0 then
      v_overlap := true;
    end if;
  else
    -- Sliding window over the FLATTENED prompt (no line boundaries to split
    -- across). Overlapping steps so a verbatim run isn't missed at a chunk
    -- edge the way per-line chunking missed a run spanning a line break.
    for v_pos in select generate_series(1, length(v_norm_prompt) - c_window_len + 1, c_step) loop
      v_window := substring(v_norm_prompt from v_pos for c_window_len);
      if position(v_window in v_norm_text) > 0 then
        v_overlap := true;
        exit;
      end if;
    end loop;
    -- The stepped loop may not land exactly on the final window; check it
    -- explicitly so the tail of the prompt is always covered.
    if not v_overlap then
      v_window := substring(v_norm_prompt from length(v_norm_prompt) - c_window_len + 1 for c_window_len);
      if position(v_window in v_norm_text) > 0 then
        v_overlap := true;
      end if;
    end if;
  end if;

  if v_overlap then
    return null;
  end if;
  return v_text;
end;
$fn$;

revoke all on function public.scrub_prompt_overlap(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- resolve_comment — now delegates the overlap check to scrub_prompt_overlap
-- instead of inlining the (buggy) per-line chunking.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_comment(p_comment_id uuid, p_summary text)
returns public.comments
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_preview uuid;
  v_comment public.comments%rowtype;
  v_summary text;
begin
  select preview_id into v_preview from public.comments where id = p_comment_id;
  if v_preview is null then raise exception 'comment_not_found' using errcode = 'P0001'; end if;
  if not public.is_preview_workspace_member(v_preview) then raise exception 'not_authorized' using errcode = '42501'; end if;

  v_summary := public.scrub_prompt_overlap(p_comment_id, p_summary);

  update public.comments set status = 'resolved', resolved_by = (select auth.uid()), resolved_summary = v_summary
   where id = p_comment_id returning * into v_comment;
  return v_comment;
end;
$fn$;

revoke all on function public.resolve_comment(uuid, text) from public;
grant execute on function public.resolve_comment(uuid, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- dismiss_comment — gains the SAME scrub (0024 never had one; correctness
-- finding). p_reason rides the identical resolved_summary/broadcast path.
-- ---------------------------------------------------------------------------
create or replace function public.dismiss_comment(p_comment_id uuid, p_reason text)
returns public.comments
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_preview uuid;
  v_comment public.comments%rowtype;
  v_reason text;
begin
  select preview_id into v_preview from public.comments where id = p_comment_id;
  if v_preview is null then raise exception 'comment_not_found' using errcode = 'P0001'; end if;
  if not public.is_preview_workspace_member(v_preview) then raise exception 'not_authorized' using errcode = '42501'; end if;

  v_reason := public.scrub_prompt_overlap(p_comment_id, p_reason);

  update public.comments set status = 'dismissed', resolved_by = (select auth.uid()), resolved_summary = v_reason
   where id = p_comment_id returning * into v_comment;
  return v_comment;
end;
$fn$;

revoke all on function public.dismiss_comment(uuid, text) from public;
grant execute on function public.dismiss_comment(uuid, text) to anon, authenticated, service_role;

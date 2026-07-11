-- =============================================================================
-- 0049_prompt_images.sql — image attachment on the member-only agent prompt (R19)
-- =============================================================================
-- A workspace member can attach image(s) to the "prompt to the agent" (0043),
-- the same way replies (0048) and comments carry images. Images live in the
-- `captures` bucket and are referenced by PATH from a new `image_refs text[]`.
-- Uploaded via the member INSERT policy (0047). The prompt is member-only
-- (RLS + no realtime broadcast), so its images are member-only too: shown on
-- the dashboard, ridden to the agent as TRUSTED, never in the guest popover.
--
-- set_agent_prompt gains a third argument. As in 0034/0048, `create or replace`
-- cannot widen an argument list, so DROP the 2-arg signature and recreate with
-- `p_image_refs text[] default '{}'` (default keeps in-flight 2-arg callers
-- resolving during a rollout). Return shape unchanged: SETOF + a bare `return;`
-- on the clear path (the "all-NULL row over PostgREST" gotcha, per 0043's note).
-- get_agent_prompt needs NO change — it returns `*`, so the new column flows.
--
-- Behavior changes vs 0043:
--   * IMAGE-ONLY prompts are allowed. "Clear" (delete the row) is now empty
--     body AND no images; an empty body WITH images is a real, stored prompt.
--     The body CHECK is relaxed from `between 1 and 4000` to a content guard
--     (non-empty body OR non-empty image_refs) plus the 4000 ceiling.
--   * HARDENING (security, mirrors 0048): every p_image_refs element must be
--     prefixed with the resolved `<preview_id>/`, and the array is length-capped
--     (shared MAX_IMAGE_REFS_PER_CARRIER = 6).
--
-- send_comment_to_agent (0044) additionally stamps the prompt's image refs onto
-- the per-send comment_queue snapshot (R7 audit parity: "what the agent was told
-- AND shown at send time"), on the genuine-insert path only — the dedup path is
-- left untouched (first-wins). This is the single additive change to that RPC.
--
-- REAL-ENV GATE (validate against live Supabase in a ROLLED-BACK txn before
-- push): image-only prompt accepted; clear = empty body + no images deletes the
-- row; a cross-preview ref is rejected; the cap is enforced; get_agent_prompt
-- returns image_refs; send stamps prompt_snapshot_image_refs on insert and the
-- dedup path leaves it untouched; get_advisors(security) clean.
-- =============================================================================

alter table public.agent_prompts
  add column if not exists image_refs text[] not null default '{}';

-- Relax the body CHECK to a content guard so an image-only prompt (empty body)
-- is representable while keeping the 4000-char ceiling. The 0043 inline column
-- check is auto-named `agent_prompts_body_check`.
alter table public.agent_prompts drop constraint if exists agent_prompts_body_check;
alter table public.agent_prompts drop constraint if exists agent_prompts_content_check;
alter table public.agent_prompts
  add constraint agent_prompts_content_check check (
    char_length(body) <= 4000
    and (char_length(btrim(body)) > 0 or coalesce(array_length(image_refs, 1), 0) > 0)
  );

alter table public.comment_queue
  add column if not exists prompt_snapshot_image_refs text[];

-- ---------------------------------------------------------------------------
-- set_agent_prompt — member-only create / edit / clear, now with images.
-- ---------------------------------------------------------------------------
drop function if exists public.set_agent_prompt(uuid, text);

create or replace function public.set_agent_prompt(
  p_comment_id uuid,
  p_body       text,
  p_image_refs text[] default '{}'
)
returns setof public.agent_prompts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_preview    uuid;
  v_session    public.review_sessions%rowtype;
  v_member_uid uuid;
  v_display    text;
  v_body       text := btrim(coalesce(p_body, ''));
  v_images     text[] := coalesce(p_image_refs, '{}');
  v_ref        text;
  c_max_body   constant integer := 4000;
  c_max_images constant integer := 6;  -- mirrors shared MAX_IMAGE_REFS_PER_CARRIER
begin
  if v_uid is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select c.preview_id into v_preview from public.comments c where c.id = p_comment_id;
  if v_preview is null then
    raise exception 'comment_not_found' using errcode = 'P0001';
  end if;

  -- Session-or-member identity. A GUEST session (role <> 'member', or no
  -- member_user_id on it) falls through to the `else` and is rejected.
  select * into v_session from public.review_sessions rs
    where rs.anon_user_id = v_uid and rs.preview_id = v_preview;
  if found and v_session.expires_at >= now()
     and v_session.role = 'member' and v_session.member_user_id is not null then
    v_member_uid := v_session.member_user_id;
    v_display    := v_session.display_name;
  elsif public.is_preview_workspace_member(v_preview) then
    v_member_uid := v_uid;
    select coalesce(u.email, 'Member') into v_display from auth.users u where u.id = v_uid;
  else
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if length(v_body) > c_max_body then
    raise exception 'body_too_large' using errcode = 'P0001';
  end if;
  if coalesce(array_length(v_images, 1), 0) > c_max_images then
    raise exception 'too_many_images' using errcode = 'P0001';
  end if;

  -- Hardening: pin every ref to EXACTLY `<preview_id>/<filename>.<ext>` — a
  -- single filename segment (no '/', so no `../` traversal to another folder)
  -- under THIS preview's folder, with an allowed extension. Stronger than a
  -- leading-prefix check (which would accept `<preview>/../<other>/x`). v_preview
  -- is from `comments` (not caller-supplied), so the pattern is injection-free.
  foreach v_ref in array v_images loop
    if v_ref is null
       or v_ref !~ ('^' || v_preview::text || '/[A-Za-z0-9_.-]+\.(png|jpe?g|webp)$') then
      raise exception 'invalid_image_ref' using errcode = 'P0001';
    end if;
  end loop;

  -- Clear: empty/whitespace body AND no images deletes the row (see header) so a
  -- subsequent read is a clean zero-rows case, same as "never had a prompt".
  if v_body = '' and coalesce(array_length(v_images, 1), 0) = 0 then
    delete from public.agent_prompts where comment_id = p_comment_id;
    return;
  end if;

  return query
  insert into public.agent_prompts as ap
    (comment_id, preview_id, body, image_refs, member_user_id, author_display_name)
  values
    (p_comment_id, v_preview, v_body, v_images, v_member_uid, v_display)
  on conflict (comment_id) do update
    set body                = excluded.body,
        image_refs          = excluded.image_refs,
        member_user_id      = excluded.member_user_id,
        author_display_name = excluded.author_display_name,
        updated_at          = now()
  returning ap.*;
end;
$$;

revoke all on function public.set_agent_prompt(uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.set_agent_prompt(uuid, text, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- send_comment_to_agent — additive: also stamp the prompt's image refs onto the
-- per-send snapshot (R7). Same signature as 0044, so `create or replace`. The
-- ONLY change vs 0044 is reading ap.image_refs and stamping it on the insert;
-- the dedup path and every gate are byte-for-byte the same contract.
-- ---------------------------------------------------------------------------
create or replace function public.send_comment_to_agent(
  p_comment_id    uuid,
  p_confirm_guest boolean default false
)
returns setof public.comment_queue
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid          uuid := (select auth.uid());
  v_preview      uuid;
  v_trust_level  text;
  v_session      public.review_sessions%rowtype;
  v_member_uid   uuid;
  v_can_send     boolean := false;
  v_prompt_body  text;
  v_prompt_author text;
  v_prompt_images text[];
  v_row          public.comment_queue%rowtype;
  v_inserted     boolean := false;
begin
  if v_uid is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select c.preview_id, c.trust_level into v_preview, v_trust_level
  from public.comments c
  where c.id = p_comment_id;

  if v_preview is null then
    raise exception 'comment_not_found' using errcode = 'P0001';
  end if;

  select * into v_session from public.review_sessions rs
    where rs.anon_user_id = v_uid and rs.preview_id = v_preview;
  if found and v_session.expires_at >= now()
     and v_session.role = 'member' and v_session.member_user_id is not null then
    v_member_uid := v_session.member_user_id;
  elsif public.is_preview_workspace_member(v_preview) then
    v_member_uid := v_uid;
  else
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.previews pv
    join public.projects pr on pr.id = pv.project_id
    join public.workspace_members wm on wm.workspace_id = pr.workspace_id
    where pv.id = v_preview
      and wm.user_id = v_member_uid
      and wm.can_send_to_agent = true
  ) into v_can_send;

  if not v_can_send then
    raise exception 'send_to_agent_forbidden' using errcode = '42501';
  end if;

  if v_trust_level = 'guest' and coalesce(p_confirm_guest, false) is not true then
    raise exception 'guest_confirm_required' using errcode = 'P0002';
  end if;

  -- Live prompt snapshot (R7): now also its image refs.
  select ap.body, ap.author_display_name, ap.image_refs
    into v_prompt_body, v_prompt_author, v_prompt_images
  from public.agent_prompts ap
  where ap.comment_id = p_comment_id;

  insert into public.comment_queue as cq
    (preview_id, comment_id, requested_by, status,
     prompt_snapshot, prompt_snapshot_author, prompt_snapshot_at,
     prompt_snapshot_image_refs)
  values
    (v_preview, p_comment_id, v_member_uid, 'pending',
     v_prompt_body, v_prompt_author,
     case when v_prompt_body is not null or coalesce(array_length(v_prompt_images, 1), 0) > 0
          then now() else null end,
     v_prompt_images)
  on conflict (comment_id) where status in ('pending', 'working') do nothing
  returning cq.* into v_row;

  v_inserted := found;

  if v_inserted then
    if v_trust_level = 'guest' then
      insert into public.agent_reference_confirmations
        (comment_id, preview_id, confirmed_by, confirmed_at)
      values
        (p_comment_id, v_preview, v_member_uid, now())
      on conflict (comment_id) do update
        set confirmed_by = excluded.confirmed_by,
            confirmed_at = excluded.confirmed_at;
    end if;

    return next v_row;
    return;
  end if;

  return query
  select * from public.comment_queue
  where comment_id = p_comment_id
    and status in ('pending', 'working');
end;
$$;

revoke all on function public.send_comment_to_agent(uuid, boolean) from public, anon, authenticated;
grant execute on function public.send_comment_to_agent(uuid, boolean) to authenticated;

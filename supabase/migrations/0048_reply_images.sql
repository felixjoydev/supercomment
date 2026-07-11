-- =============================================================================
-- 0048_reply_images.sql — image attachments on thread replies (R19)
-- =============================================================================
-- A reviewer (overlay) or a member (overlay or dashboard) can attach image(s) to
-- a thread reply, the same way a comment carries reviewer reference images
-- (context.referenceImages). Images are stored OUT-OF-BAND in the `captures`
-- bucket (0027) and referenced by PATH from a new `image_refs text[]` column;
-- bytes never inflate the reply row or the realtime broadcast. Display + agent
-- hand-off sign these paths on read via the shared resolveCaptureSrc.
--
-- Uploads: the overlay writes via its session (0027 insert policy); a dashboard
-- member writes via the member insert policy added in 0047. Both produce the
-- same `<previewId>/<uuid>.<ext>` path, so a reply image is indistinguishable
-- from a reference image downstream.
--
-- create_review_reply gains a third argument. `create or replace` cannot change
-- an argument list, so (mirroring 0034) we DROP the 2-arg signature and recreate
-- with `p_image_refs text[] default '{}'`. The default keeps any in-flight 2-arg
-- PostgREST caller resolving to this one function during a rollout. Return shape
-- is unchanged: a bare `returns public.comment_replies` rowtype (it always
-- returns exactly one freshly-inserted row or raises — the SETOF "all-NULL row"
-- gotcha does not apply here).
--
-- Additive behavior changes vs 0033:
--   * IMAGE-ONLY replies are allowed: the empty-body guard now rejects only when
--     the body AND the image list are both empty (an image can carry the reply).
--     The body column stays NOT NULL, so an image-only reply stores body = ''.
--   * HARDENING (security): every element of p_image_refs must be prefixed with
--     the resolved `<preview_id>/`, and the array is length-capped. Without this
--     a client could stash an arbitrary or cross-preview path into image_refs
--     that a member / the agent would later sign. The cap mirrors the shared
--     MAX_IMAGE_REFS_PER_CARRIER (6).
--
-- The 0038 reply broadcast carries the full row, so image_refs rides it — that
-- is fine (replies are guest-readable; only the member-only agent_prompts stays
-- off the wire). No trigger change.
--
-- REAL-ENV GATE (validate against live Supabase in a ROLLED-BACK txn before
-- push): an image-only reply is accepted; a cross-preview ref is rejected; the
-- cap is enforced; get_advisors(security) clean; the overlay + dashboard upload
-- round-trips render.
-- =============================================================================

alter table public.comment_replies
  add column if not exists image_refs text[] not null default '{}';

drop function if exists public.create_review_reply(uuid, text);

create or replace function public.create_review_reply(
  p_comment_id uuid,
  p_body       text,
  p_image_refs text[] default '{}'
)
returns public.comment_replies
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := (select auth.uid());
  v_preview     uuid;
  v_session     public.review_sessions%rowtype;
  v_author_user uuid;
  v_display     text;
  v_role        text;
  v_participant uuid;
  v_reply       public.comment_replies%rowtype;
  v_images      text[] := coalesce(p_image_refs, '{}');
  v_ref         text;
  c_max_body   constant integer := 4000;
  c_max_images constant integer := 6;  -- mirrors shared MAX_IMAGE_REFS_PER_CARRIER
begin
  if v_uid is null then
    raise exception 'no_review_session' using errcode = '42501';
  end if;
  -- Image-only replies are allowed: reject only when body AND images are empty.
  if length(coalesce(btrim(p_body), '')) = 0
     and coalesce(array_length(v_images, 1), 0) = 0 then
    raise exception 'empty_body' using errcode = 'P0001';
  end if;
  if length(p_body) > c_max_body then
    raise exception 'body_too_large' using errcode = 'P0001';
  end if;
  if coalesce(array_length(v_images, 1), 0) > c_max_images then
    raise exception 'too_many_images' using errcode = 'P0001';
  end if;

  select c.preview_id into v_preview from public.comments c where c.id = p_comment_id;
  if v_preview is null then
    raise exception 'comment_not_found' using errcode = 'P0001';
  end if;

  -- Hardening: pin every ref to EXACTLY `<preview_id>/<filename>.<ext>` — a
  -- single filename segment (no '/', so no `../` traversal to another folder)
  -- under THIS preview's folder, with an allowed extension. This is stronger
  -- than a leading-prefix check (which would accept `<preview>/../<other>/x`):
  -- it mirrors the 0027/0047 RLS leading-segment scoping AND forecloses a
  -- crafted path a reader/agent/signer would later resolve. v_preview is from
  -- `comments` (not caller-supplied), so the built pattern is injection-free.
  foreach v_ref in array v_images loop
    if v_ref is null
       or v_ref !~ ('^' || v_preview::text || '/[A-Za-z0-9_.-]+\.(png|jpe?g|webp)$') then
      raise exception 'invalid_image_ref' using errcode = 'P0001';
    end if;
  end loop;

  -- Attribution: an active review session (guest OR member reviewing) wins; else a
  -- signed-in workspace member (dashboard). Members map to their real account so
  -- overlay and dashboard identity dedupe via the participant.
  select * into v_session from public.review_sessions rs
    where rs.anon_user_id = v_uid and rs.preview_id = v_preview;
  if found and v_session.expires_at >= now() then
    v_author_user := coalesce(v_session.member_user_id, v_uid);
    v_display     := v_session.display_name;
    v_role        := v_session.role;
  elsif public.is_preview_workspace_member(v_preview) then
    v_author_user := v_uid;
    select coalesce(u.email, 'Member') into v_display from auth.users u where u.id = v_uid;
    v_role        := 'member';
  else
    raise exception 'no_review_session' using errcode = '42501';
  end if;

  insert into public.participants as pt (preview_id, user_id, display_name, trust_level)
    values (v_preview, v_author_user, v_display, v_role)
    on conflict (preview_id, user_id) where user_id is not null
    do update set display_name = excluded.display_name
    returning pt.id into v_participant;

  insert into public.comment_replies
    (comment_id, preview_id, author_participant, author_display_name, trust_level, body, image_refs)
    values (
      p_comment_id, v_preview, v_participant, v_display, v_role,
      coalesce(btrim(p_body), ''), v_images
    )
    returning * into v_reply;
  return v_reply;
end;
$$;

-- Revoke from public AND anon AND authenticated: DROP+CREATE lands Supabase's
-- default anon/authenticated EXECUTE grants fresh on the new signature, and
-- `revoke from public` alone does NOT strip explicit role grants (the 0008 grant
-- post-mortem, see 0027). The body already fails-closed for anon (auth.uid() is
-- null → no_review_session), but keep the grant surface minimal regardless.
revoke all on function public.create_review_reply(uuid, text, text[])
  from public, anon, authenticated;
grant execute on function public.create_review_reply(uuid, text, text[]) to authenticated;

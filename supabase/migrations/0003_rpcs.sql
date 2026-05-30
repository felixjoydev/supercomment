-- =============================================================================
-- SuperComment — U2 RPCs (the security-definer write choke point)
-- =============================================================================
-- All functions are SECURITY DEFINER with `set search_path = ''` and fully
-- schema-qualified identifiers. They run as the owning (migration) role, so
-- they bypass RLS to do the controlled writes — guests never touch base tables
-- directly. Each function REVOKEs the default PUBLIC execute grant and then
-- GRANTs to the appropriate role(s).
--
-- Atomic per-preview numbering uses `UPDATE previews SET comment_seq =
-- comment_seq + 1 ... RETURNING` (Postgres sequences are NOT gap-free and would
-- not be transaction-safe here). Numbers are never reused, even after a comment
-- is resolved/dismissed.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- create_guest_comment
--   Guest write path. Validates the link secret (existence, access mode,
--   expiry), upserts the guest participant, allocates the next number, and
--   inserts the comment with trust_level = 'guest'.
-- ---------------------------------------------------------------------------
create or replace function public.create_guest_comment(
  p_link_secret  text,
  p_path         text,
  p_display_name text,
  p_intent       text,
  p_severity     text,
  p_note         text,
  p_context      jsonb,
  p_fidelity     text default 'live'
)
returns public.comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preview     public.previews%rowtype;
  v_uid         uuid := (select auth.uid());
  v_participant uuid;
  v_number      integer;
  v_comment     public.comments%rowtype;
begin
  -- Find the preview by its guest-link secret.
  select * into v_preview
  from public.previews
  where link_secret = p_link_secret;

  if not found then
    raise exception 'invalid_or_revoked_link' using errcode = 'P0001';
  end if;

  if v_preview.access_mode <> 'guest_link' then
    raise exception 'guest_access_not_enabled' using errcode = 'P0001';
  end if;

  if v_preview.expires_at is not null and v_preview.expires_at <= now() then
    raise exception 'link_expired' using errcode = 'P0001';
  end if;

  -- Upsert the guest participant (authoritative identity = auth.uid()).
  if v_uid is not null then
    insert into public.participants (preview_id, user_id, display_name, trust_level)
    values (v_preview.id, v_uid, coalesce(nullif(p_display_name, ''), 'Guest'), 'guest')
    on conflict (preview_id, user_id) where user_id is not null
    do update set display_name = excluded.display_name
    returning id into v_participant;
  else
    -- No anonymous session yet: create a fresh, un-deduplicated participant.
    insert into public.participants (preview_id, user_id, display_name, trust_level)
    values (v_preview.id, null, coalesce(nullif(p_display_name, ''), 'Guest'), 'guest')
    returning id into v_participant;
  end if;

  -- Atomic per-preview numbering.
  update public.previews
  set comment_seq = comment_seq + 1
  where id = v_preview.id
  returning comment_seq into v_number;

  insert into public.comments (
    preview_id, number, author_participant, trust_level,
    intent, severity, note, path, context, fidelity
  )
  values (
    v_preview.id, v_number, v_participant, 'guest',
    p_intent, p_severity, p_note, p_path,
    coalesce(p_context, '{}'::jsonb), coalesce(nullif(p_fidelity, ''), 'live')
  )
  returning * into v_comment;

  return v_comment;
end;
$$;

revoke execute on function
  public.create_guest_comment(text, text, text, text, text, text, jsonb, text)
  from public;
grant execute on function
  public.create_guest_comment(text, text, text, text, text, text, jsonb, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_member_comment
--   Member write path. Requires team membership on the preview. Same atomic
--   numbering; trust_level = 'member'.
-- ---------------------------------------------------------------------------
create or replace function public.create_member_comment(
  p_preview_id   uuid,
  p_path         text,
  p_display_name text,
  p_intent       text,
  p_severity     text,
  p_note         text,
  p_context      jsonb,
  p_fidelity     text default 'live'
)
returns public.comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := (select auth.uid());
  v_participant uuid;
  v_number      integer;
  v_comment     public.comments%rowtype;
begin
  if v_uid is null or not public.is_preview_team_member(p_preview_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  insert into public.participants (preview_id, user_id, display_name, trust_level)
  values (p_preview_id, v_uid, coalesce(nullif(p_display_name, ''), 'Member'), 'member')
  on conflict (preview_id, user_id) where user_id is not null
  do update set display_name = excluded.display_name
  returning id into v_participant;

  update public.previews
  set comment_seq = comment_seq + 1
  where id = p_preview_id
  returning comment_seq into v_number;

  insert into public.comments (
    preview_id, number, author_participant, trust_level,
    intent, severity, note, path, context, fidelity
  )
  values (
    p_preview_id, v_number, v_participant, 'member',
    p_intent, p_severity, p_note, p_path,
    coalesce(p_context, '{}'::jsonb), coalesce(nullif(p_fidelity, ''), 'live')
  )
  returning * into v_comment;

  return v_comment;
end;
$$;

revoke execute on function
  public.create_member_comment(uuid, text, text, text, text, text, jsonb, text)
  from public;
grant execute on function
  public.create_member_comment(uuid, text, text, text, text, text, jsonb, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- resolve_comment — member-only. Sets status=resolved + resolved_by + summary.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_comment(
  p_comment_id uuid,
  p_summary    text
)
returns public.comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preview uuid;
  v_comment public.comments%rowtype;
begin
  select preview_id into v_preview
  from public.comments
  where id = p_comment_id;

  if v_preview is null then
    raise exception 'comment_not_found' using errcode = 'P0001';
  end if;

  if not public.is_preview_team_member(v_preview) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.comments
  set status           = 'resolved',
      resolved_by      = (select auth.uid()),
      resolved_summary = p_summary
  where id = p_comment_id
  returning * into v_comment;

  return v_comment;
end;
$$;

revoke execute on function public.resolve_comment(uuid, text) from public;
grant execute on function public.resolve_comment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- dismiss_comment — member-only. Sets status=dismissed + resolved_by + reason.
-- ---------------------------------------------------------------------------
create or replace function public.dismiss_comment(
  p_comment_id uuid,
  p_reason     text
)
returns public.comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preview uuid;
  v_comment public.comments%rowtype;
begin
  select preview_id into v_preview
  from public.comments
  where id = p_comment_id;

  if v_preview is null then
    raise exception 'comment_not_found' using errcode = 'P0001';
  end if;

  if not public.is_preview_team_member(v_preview) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.comments
  set status           = 'dismissed',
      resolved_by      = (select auth.uid()),
      resolved_summary = p_reason
  where id = p_comment_id
  returning * into v_comment;

  return v_comment;
end;
$$;

revoke execute on function public.dismiss_comment(uuid, text) from public;
grant execute on function public.dismiss_comment(uuid, text) to authenticated;

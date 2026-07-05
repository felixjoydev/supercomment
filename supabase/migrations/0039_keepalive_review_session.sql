-- 0039 - sliding review-session lifetime + link-gated revive.
--
-- Sessions still open with an 8h window (0019), but instead of a hard 8h death
-- the overlay now KEEPS THEM ALIVE while the reviewer is active, and offers a
-- Renew button when one has lapsed after inactivity. Both go through this one RPC.
--
-- The review LINK stays the real credential: keepalive re-validates that the link
-- is still active for this session's role (a member is still in the workspace; a
-- guest_link is still on, not expired, secret present). So turning off / expiring
-- the guest link still ends access, even for a device that once had a session.
-- (Nuance: rotating the secret to a NEW value is not caught here since the session
-- does not store the secret; disable the guest link to fully revoke.)
--
-- Gated on auth.uid() (the anon/member user), NOT on the session being unexpired,
-- so it can revive a lapsed session as long as the link is still valid.
create or replace function public.keepalive_review_session(p_preview_id uuid)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_uid        uuid := (select auth.uid());
  v_session    public.review_sessions%rowtype;
  v_ok         boolean := false;
  v_new_expiry timestamptz := now() + interval '8 hours';
begin
  if v_uid is null then raise exception 'no_review_session' using errcode = '42501'; end if;

  select * into v_session from public.review_sessions rs
    where rs.anon_user_id = v_uid and rs.preview_id = p_preview_id;
  if not found then raise exception 'no_review_session' using errcode = '42501'; end if;

  if v_session.role = 'member' then
    v_ok := public.is_preview_workspace_member(p_preview_id);
  else
    select (pv.access_mode = 'guest_link'
            and pv.link_secret is not null
            and (pv.expires_at is null or pv.expires_at > now()))
      into v_ok
      from public.previews pv where pv.id = p_preview_id;
  end if;

  if not coalesce(v_ok, false) then
    raise exception 'access_revoked' using errcode = '42501';
  end if;

  update public.review_sessions
    set expires_at = v_new_expiry
    where anon_user_id = v_uid and preview_id = p_preview_id;
  return v_new_expiry;
end;
$$;
revoke all on function public.keepalive_review_session(uuid) from public, anon;
grant execute on function public.keepalive_review_session(uuid) to authenticated;

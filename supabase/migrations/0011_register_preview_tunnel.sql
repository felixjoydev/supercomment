-- 0011_register_preview_tunnel.sql
-- U4 backend half: the RPC `supercomment start` calls to publish its current
-- tunnel URL under a stable preview, plus a lookup the /s/<slug> route uses to
-- resolve where to proxy.
--
-- The stable shareable link is `…/s/<slug>` (owned by the hosted app). The CLI's
-- ephemeral cloudflared URL changes each session, so the CLI registers it here;
-- the /s/<slug> route reads it back and reverse-proxies. This keeps the link the
-- developer shares constant across restarts (R3).

-- ---------------------------------------------------------------------------
-- register_preview_tunnel — member-only. Sets the preview's current tunnel URL,
-- access mode, and marks it live. Returns the slug so the CLI can print the
-- stable …/s/<slug> link. SECURITY DEFINER + search_path='' like the other RPCs;
-- authorization is an explicit is_preview_team_member check (NOT open to anon).
-- ---------------------------------------------------------------------------
create or replace function public.register_preview_tunnel(
  p_preview_id  uuid,
  p_tunnel_url  text,
  p_access_mode text default 'team_only'
)
returns table (slug text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.is_preview_team_member(p_preview_id) then
    raise exception 'not authorized for this preview' using errcode = '42501';
  end if;
  if p_tunnel_url is null or p_tunnel_url !~ '^https?://' then
    raise exception 'tunnel url must be an absolute http(s) URL' using errcode = 'P0001';
  end if;
  if p_access_mode not in ('team_only', 'guest_link') then
    raise exception 'invalid access mode' using errcode = 'P0001';
  end if;

  return query
  update public.previews pv
     set current_tunnel_url = p_tunnel_url,
         access_mode        = p_access_mode,
         status             = 'live',
         last_heartbeat_at  = now()
   where pv.id = p_preview_id
  returning pv.slug;
end;
$$;

revoke execute on function public.register_preview_tunnel(uuid, text, text) from public, anon;
grant execute on function public.register_preview_tunnel(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- resolve_tunnel_for_slug — used by the /s/<slug> route to find where to proxy.
-- Returns the current tunnel URL + status + access mode for a slug. SECURITY
-- DEFINER so the route (which may run before the viewer authenticates) can read
-- just these routing fields without exposing the whole previews row. Returns no
-- row for an unknown slug. Safe to expose: it reveals only whether a slug is
-- live and its tunnel host, which a viewer with the link needs anyway. Guest
-- access control on the CONTENT is enforced by access_mode + link_secret at the
-- route/overlay layer, not here.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_tunnel_for_slug(p_slug text)
returns table (
  preview_id        uuid,
  current_tunnel_url text,
  status            text,
  access_mode       text,
  expires_at        timestamptz
)
language sql
security definer
set search_path = ''
stable
as $$
  select pv.id, pv.current_tunnel_url, pv.status, pv.access_mode, pv.expires_at
  from public.previews pv
  where pv.slug = p_slug;
$$;

revoke execute on function public.resolve_tunnel_for_slug(text) from public;
grant execute on function public.resolve_tunnel_for_slug(text) to anon, authenticated;

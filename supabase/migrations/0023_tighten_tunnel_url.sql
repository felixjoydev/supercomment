-- =============================================================================
-- 0023_tighten_tunnel_url.sql — Embedded Deployed Review Mode (U10 / R17, F8)
-- =============================================================================
-- register_preview_tunnel (0011) accepted ANY absolute http(s) URL. The /s/<slug>
-- route REVERSE-PROXIES whatever is stored in previews.current_tunnel_url, so an
-- arbitrary URL there is a server-side request forgery (SSRF) vector: a member
-- could point a preview at an internal host and have the hosted app fetch it.
--
-- Tunnel mode is now disabled by default (the CLI `start` gate + the embedded
-- mode), but the proxy code is RETAINED behind a flag — so the SSRF bug would
-- re-activate the moment the flag is flipped. This migration tightens the writer
-- (the authoritative boundary) so the retained path is safe to re-enable.
--
-- CREATE OR REPLACE with the EXACT 0011 signature
-- (p_preview_id uuid, p_tunnel_url text, p_access_mode text default 'team_only')
-- returns table(slug text) — NO overload is created, the existing grants are
-- preserved, and the function body is unchanged except for the URL allowlist.
--
-- Mirrors register_preview_tunnel (0011) / register_deploy_target (0017) house
-- style EXACTLY: SECURITY DEFINER + `set search_path = ''` + fully
-- schema-qualified identifiers, authorized by an explicit is_preview_team_member
-- check (NOT open to anon), default PUBLIC/anon execute revoked and EXECUTE
-- granted to `authenticated` only.
--
-- Allowlist (the tunnel URL the CLI registers is always cloudflared's quick
-- tunnel; localhost is permitted for dev/e2e):
--   * https scheme only (reject http: and everything else)
--   * no embedded credentials (user:pass@host)
--   * host is a cloudflared quick-tunnel subdomain (*.trycloudflare.com) OR
--     localhost / 127.0.0.1 (dev). Everything else — IP literals, IPv6, internal
--     hosts, look-alike domains — is rejected.
-- =============================================================================

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
  v_uid       uuid := (select auth.uid());
  v_url       text := btrim(coalesce(p_tunnel_url, ''));
  v_lower     text := lower(v_url);
  v_authority text;
  v_host      text;
begin
  -- ---- Authorization (unchanged from 0011) --------------------------------
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.is_preview_team_member(p_preview_id) then
    raise exception 'not authorized for this preview' using errcode = '42501';
  end if;

  -- ---- Tunnel-URL allowlist (SSRF guard, NEW) -----------------------------
  if v_lower !~ '^https://' then
    raise exception 'tunnel url must use https' using errcode = 'P0001';
  end if;

  -- authority = chars after https:// up to the first '/', '?' or '#'.
  v_authority := substring(v_lower from '^https://([^/?#]*)');
  if v_authority is null or v_authority = '' then
    raise exception 'tunnel url has no host' using errcode = 'P0001';
  end if;
  if position('@' in v_authority) > 0 then
    raise exception 'tunnel url must not contain credentials' using errcode = 'P0001';
  end if;

  -- strip an optional :port (IPv6's bracket form can never match the allowlist
  -- below, so it is rejected there).
  v_host := split_part(v_authority, ':', 1);
  if not (
       v_host like '%.trycloudflare.com'   -- cloudflared quick tunnel
    or v_host = 'localhost'                 -- dev
    or v_host = '127.0.0.1'                 -- dev
  ) then
    raise exception
      'tunnel url host must be a *.trycloudflare.com quick tunnel or localhost'
      using errcode = 'P0001';
  end if;

  -- ---- Access mode (unchanged from 0011) ----------------------------------
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

-- Grants unchanged from 0011 (re-issued idempotently; same signature → no overload).
revoke execute on function public.register_preview_tunnel(uuid, text, text) from public, anon;
grant execute on function public.register_preview_tunnel(uuid, text, text) to authenticated;

-- =============================================================================
-- 0017_register_deploy_target.sql — Embedded Deployed Review Mode (U13)
-- =============================================================================
-- register_deploy_target — member-only. Sets a preview's stable deploy_url: the
-- developer's own always-on deployed origin the embedded /s link redirects
-- reviewers to (the previews.deploy_url column added in 0016). This closes the
-- "nothing writes deploy_url" gap so /s has a target in embedded mode.
--
-- Mirrors register_preview_tunnel (0011) house style EXACTLY: SECURITY DEFINER +
-- `set search_path = ''` + fully schema-qualified identifiers, authorized by an
-- explicit is_preview_team_member check (NOT open to anon), default PUBLIC/anon
-- execute revoked and EXECUTE granted to `authenticated` only.
--
-- The deploy_url is validated against an allowlist BEFORE it is stored, because
-- /s later TRUSTS it as a redirect target (validate-at-registration,
-- trust-at-redirect). An attacker-controlled deploy_url would be a token-theft /
-- open-redirect / SSRF vector. These rules mirror the shared TS validator in
-- apps/web/lib/external-redirect.ts (isAllowedDeployUrl) one-for-one — the
-- dashboard validates there for UX, this RPC is the authoritative boundary
-- (defense in depth):
--   * https scheme only (reject http / data: / javascript: / etc.)
--   * no embedded credentials (user:pass@host)
--   * no IP literals (IPv4 in any form, or IPv6) — this also covers every
--     private/loopback range, since those are all IP literals
--   * no localhost / *.localhost, no *.local (mDNS)
--   * a dotted, non-numeric public host (single-label names rejected)
-- HARDENING FOLLOW-UP (NOT built now): pin the host to known preview-CDN
-- patterns (*.vercel.app, *.netlify.app, *.pages.dev, *.fly.dev, *.onrender.com)
-- or a domain the team has proven it owns. v1 accepts any public https host.
--
-- p_commit is accepted for API stability (and the deferred CI auto-registration
-- of deploy_url/commit) but is NOT persisted at the preview level: per-comment
-- provenance (deploy_url + commit a comment was captured against, R14) rides in
-- comments.context jsonb (CapturedContext.deployUrl/.commit), captured at comment
-- creation — 0016 deliberately added no previews.commit column. When commit is
-- absent the comment still saves and the dashboard shows "no commit recorded"
-- (graceful, provenance-absent degradation). deploy_url stays nullable: a
-- preview with no deploy_url simply is not embeddable yet.
--
-- Numbering: 0012-0014 are the hardening branch's (share access / guest abuse /
-- team invites); this branch's embedded-review series runs 0016, 0017, …
-- =============================================================================

create or replace function public.register_deploy_target(
  p_preview_id uuid,
  p_deploy_url text,
  p_commit     text default null
)
returns table (slug text, deploy_url text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_url       text := btrim(coalesce(p_deploy_url, ''));
  v_lower     text := lower(v_url);
  v_authority text;
  v_host      text;
begin
  -- ---- Authorization (mirror register_preview_tunnel) ---------------------
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.is_preview_team_member(p_preview_id) then
    raise exception 'not authorized for this preview' using errcode = '42501';
  end if;

  -- ---- Allowlist validation (mirror of isAllowedDeployUrl) ----------------
  if v_lower !~ '^https://' then
    raise exception 'deploy url must use https' using errcode = 'P0001';
  end if;

  -- authority = chars after https:// up to the first '/', '?' or '#'.
  v_authority := substring(v_lower from '^https://([^/?#]*)');
  if v_authority is null or v_authority = '' then
    raise exception 'deploy url has no host' using errcode = 'P0001';
  end if;
  if position('@' in v_authority) > 0 then
    raise exception 'deploy url must not contain credentials' using errcode = 'P0001';
  end if;
  -- IPv6 literals are bracketed, e.g. https://[::1] .
  if position('[' in v_authority) > 0 then
    raise exception 'deploy url host must not be an IP literal' using errcode = 'P0001';
  end if;

  -- strip an optional :port (no IPv6 here — the bracket form was rejected above)
  v_host := split_part(v_authority, ':', 1);
  if v_host = '' then
    raise exception 'deploy url has no host' using errcode = 'P0001';
  end if;
  if v_host = 'localhost' or v_host like '%.localhost' then
    raise exception 'deploy url host must not be localhost' using errcode = 'P0001';
  end if;
  if v_host = 'local' or v_host like '%.local' then
    raise exception 'deploy url host must not be a .local (mDNS) name' using errcode = 'P0001';
  end if;
  if position('.' in v_host) = 0 then
    raise exception 'deploy url host must be a public domain' using errcode = 'P0001';
  end if;
  -- all-numeric dotted host (IPv4 literal) or a numeric final label (real
  -- domains never have a numeric TLD).
  if v_host ~ '^[0-9.]+$' or v_host ~ '\.[0-9]+$' then
    raise exception 'deploy url host must not be an IP literal' using errcode = 'P0001';
  end if;

  -- ---- Persist (store the original, un-lowercased value) ------------------
  return query
  update public.previews pv
     set deploy_url = v_url
   where pv.id = p_preview_id
  returning pv.slug, pv.deploy_url;
end;
$$;

revoke execute on function public.register_deploy_target(uuid, text, text) from public, anon;
grant execute on function public.register_deploy_target(uuid, text, text) to authenticated;

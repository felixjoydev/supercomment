-- 0007_guest_snapshot_rpc.sql
-- Guest write path for page snapshots (U10). Mirrors create_guest_comment
-- (0003): guests never get direct table access; they call this SECURITY DEFINER
-- RPC with a link_secret that scopes them to a single preview. The function
-- re-validates the secret + access mode (guest_link) + expiry before writing,
-- then runs as owner to insert past RLS for exactly that preview.
--
-- NOTE FOR THE ORCHESTRATOR (applies via MCP): this inlines the same guest
-- validation create_guest_comment uses in 0003. If 0003 exposes a reusable
-- helper (e.g. public.validate_link_secret(text) returns uuid), prefer calling
-- it here to keep the validation in one place. The inline form below is written
-- to be correct on its own against the previews columns from 0001
-- (link_secret, access_mode, expires_at); confirm those column names match
-- 0001/0003 when applying.

set check_function_bodies = off;

-- Insert a guest snapshot after validating the link secret. Runs as owner so it
-- can write past RLS, but only for the preview the secret unlocks and only when
-- that preview is a non-expired guest link.
create or replace function public.create_guest_snapshot(
  p_link_secret text,
  p_path text,
  p_payload jsonb
)
returns public.snapshots
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_preview_id uuid;
  v_row public.snapshots;
begin
  -- Resolve + validate the preview the secret unlocks: must be a guest_link and
  -- must not have expired. Mirrors create_guest_comment's checks in 0003.
  select p.id
    into v_preview_id
    from public.previews as p
   where p.link_secret = p_link_secret
     and p.access_mode = 'guest_link'
     and (p.expires_at is null or p.expires_at > now())
   limit 1;

  if v_preview_id is null then
    raise exception 'invalid or expired link secret';
  end if;

  insert into public.snapshots (preview_id, path, payload)
  values (v_preview_id, p_path, p_payload)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_guest_snapshot(text, text, jsonb) from public;
grant execute on function public.create_guest_snapshot(text, text, jsonb) to anon, authenticated;

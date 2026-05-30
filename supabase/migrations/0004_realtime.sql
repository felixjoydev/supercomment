-- =============================================================================
-- SuperComment — U2 realtime (Broadcast-from-database on private channels)
-- =============================================================================
-- Comment inserts/updates are broadcast to a per-preview private topic
-- ("preview:<id>") via realtime.broadcast_changes(). We use Broadcast-from-DB
-- (NOT raw Postgres Changes) because Postgres Changes does not apply RLS to
-- DELETEs and scales worse. Subscription is authorized by an RLS policy on
-- realtime.messages that lets only the preview's team members and the preview's
-- own participants receive its topic.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Broadcast trigger function. Best-effort: a realtime hiccup must never block
-- the comment write, so failures are downgraded to a warning. The actual
-- AE6 assertion in the tests verifies a message row is produced when realtime
-- is available (the intended test environment).
-- ---------------------------------------------------------------------------
create or replace function public.broadcast_comment_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preview_id uuid := coalesce(new.preview_id, old.preview_id);
  v_topic      text := 'preview:' || v_preview_id::text;
begin
  begin
    perform realtime.broadcast_changes(
      v_topic,           -- topic
      tg_op,             -- event
      tg_op,             -- operation
      tg_table_name,     -- table
      tg_table_schema,   -- schema
      new,               -- new record
      old                -- old record
    );
  exception when others then
    raise warning 'broadcast_comment_change failed for %: %', v_topic, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists comments_broadcast on public.comments;
create trigger comments_broadcast
  after insert or update on public.comments
  for each row execute function public.broadcast_comment_change();

-- ---------------------------------------------------------------------------
-- can_subscribe_preview — parses a "preview:<uuid>" topic and authorizes the
-- current user as either a team member of, or a participant on, that preview.
-- ---------------------------------------------------------------------------
create or replace function public.can_subscribe_preview(p_topic text)
returns boolean
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_preview_id uuid;
begin
  if p_topic is null or p_topic !~ '^preview:' then
    return false;
  end if;

  begin
    v_preview_id := substring(p_topic from 9)::uuid;  -- skip 'preview:'
  exception when others then
    return false;
  end;

  return public.is_preview_team_member(v_preview_id)
      or public.is_preview_participant(v_preview_id);
end;
$$;

revoke execute on function public.can_subscribe_preview(text) from public;
grant execute on function public.can_subscribe_preview(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- realtime.messages RLS — authorize receiving (SELECT) broadcast messages on a
-- preview topic only for authorized users. RLS is already enabled on
-- realtime.messages by Supabase; we only (re)create the policy.
-- ---------------------------------------------------------------------------
drop policy if exists "supercomment preview broadcast read" on realtime.messages;
create policy "supercomment preview broadcast read"
  on realtime.messages
  for select
  to authenticated
  using (
    (select realtime.messages.extension) = 'broadcast'
    and public.can_subscribe_preview((select realtime.topic()))
  );

-- 0035 - populate comments.path from context.url (best-effort denormalization).
--
-- Grouping for the per-page comment index is authoritative at READ TIME on the
-- shared TS pageKeyOf(context.url) helper. This migration is a best-effort
-- denormalization of that page key onto comments.path so the MCP read model and
-- future queries have a column to group on. It is deliberately NOT the grouping
-- key: page_key_from_url() is a pragmatic SQL approximation of WHATWG
-- `new URL(url).pathname` (good enough for agent context), not a byte-identical
-- match, so the TS helper stays the source of truth for what the UI groups on.
--
-- Decoupled from create_review_comment (the load-bearing write path) via a
-- BEFORE INSERT trigger, so this migration and 0037 never both edit that function.
-- Additive + idempotent.

-- page_key_from_url - pathname of an absolute http(s)-style URL, query + fragment
-- dropped, trailing slash normalized off (root stays "/"). NULL when the URL is not
-- an absolute URL (mirrors `new URL()` throwing on a relative/garbage input), so
-- such comments bucket under "Other" in the index. Case is preserved.
create or replace function public.page_key_from_url(p_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_url is null then null
    when p_url !~* '^[a-z][a-z0-9+.-]*://[^/?#]' then null
    else (
      select case
        when length(p) > 1 and right(p, 1) = '/' then left(p, length(p) - 1)
        else p
      end
      from (
        select coalesce(
          nullif(
            regexp_replace(
              regexp_replace(p_url, '^[a-z][a-z0-9+.-]*://[^/?#]*', '', 'i'),
              '[?#].*$', ''
            ),
          ''),
          '/'
        ) as p
      ) q
    )
  end
$$;

-- BEFORE INSERT: stamp path from context.url when the caller did not set it (the
-- live embedded write path never sets path; the dormant tunnel path does, and we
-- leave those alone).
-- SECURITY INVOKER: a BEFORE trigger that only stamps NEW needs no elevated
-- privileges. Revoked from public so it is never exposed as an RPC (the trigger
-- fires regardless of EXECUTE grants).
create or replace function public.set_comment_path()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.path is null then
    new.path := public.page_key_from_url(new.context->>'url');
  end if;
  return new;
end;
$$;
revoke all on function public.set_comment_path() from public;

create or replace trigger comments_set_path
  before insert on public.comments
  for each row execute function public.set_comment_path();

-- Backfill existing rows (idempotent via the null guard; unparseable URLs stay null).
update public.comments
  set path = public.page_key_from_url(context->>'url')
  where path is null;

revoke all on function public.page_key_from_url(text) from public;
grant execute on function public.page_key_from_url(text) to authenticated;

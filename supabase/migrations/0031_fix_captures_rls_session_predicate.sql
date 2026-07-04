-- 0031 — fix captures storage RLS broken by 0030.
--
-- 0030 (enable RLS + revoke anon/authenticated grants on review_sessions /
-- review_tokens) was correct hardening, but it broke the 0027 captures storage
-- policies. Those read `public.review_sessions` INLINE, and an RLS policy is
-- evaluated AS THE CALLING ROLE — so the review-session uploader (role
-- `authenticated`, which no longer has SELECT on review_sessions) now hits
-- "permission denied for table review_sessions" and EVERY capture upload fails,
-- silently falling back to the DOM snapshot. Same class of bug as 0009 (a table/
-- function used in a policy must be reachable by the invoking role, and SECURITY
-- DEFINER governs the body, not invoke rights).
--
-- Fix: a SECURITY DEFINER predicate that answers ONLY "does the current caller
-- have a live review session for this preview" — a boolean that leaks no rows —
-- granted to `authenticated` exactly like `is_preview_workspace_member`. Both
-- captures policies call it instead of selecting the table directly. No grant on
-- review_sessions is restored, so 0030's hardening stands.

create or replace function public.has_active_review_session(p_preview_text text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.review_sessions rs
    where rs.anon_user_id = (select auth.uid())
      and rs.preview_id::text = p_preview_text
      and rs.expires_at > now()
  );
$$;

revoke all on function public.has_active_review_session(text) from public;
grant execute on function public.has_active_review_session(text) to authenticated;

-- UPLOAD — only a caller with a live review session for that preview.
drop policy if exists "captures upload within active review session" on storage.objects;
create policy "captures upload within active review session"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'captures'
    and public.has_active_review_session((storage.foldername(name))[1])
  );

-- READ — the reviewer (active session) OR a workspace member (dashboard). The
-- member branch is unchanged; only the session branch moves behind the predicate.
drop policy if exists "captures read within session or as workspace member" on storage.objects;
create policy "captures read within session or as workspace member"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'captures'
    and (
      public.has_active_review_session((storage.foldername(name))[1])
      or exists (
        select 1
        from public.previews p
        where p.id::text = (storage.foldername(name))[1]
          and public.is_preview_workspace_member(p.id)
      )
    )
  );

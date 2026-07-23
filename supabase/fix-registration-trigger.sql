-- ═══════════════════════════════════════════════════════════════
--  Parafour Customer Portal — live-database fix script
--
--  RUN THIS: paste this entire file into the Supabase SQL Editor
--  (https://supabase.com/dashboard/project/rzwczgdbkmdwpyrlcueo/sql/new)
--  and click "Run". It is idempotent — safe to run more than once.
--
--  This file cannot be run for you — an AI agent has no access to your
--  live Supabase project. You must run it yourself.
--
--  What it fixes:
--   1. Registration not creating a portal_users row (no DB trigger
--      existed on auth.users to create the profile row on sign-up).
--   2. "infinite recursion detected in policy for relation portal_users"
--      — the original admin RLS policies queried portal_users from
--      within a policy ON portal_users, which is self-referential and
--      made every admin-gated query fail. This was silently breaking
--      the admin dashboard, user management page, and Tier 2 approvals.
--
--  Also merged into supabase/schema.sql for any future fresh install.
-- ═══════════════════════════════════════════════════════════════


-- ─── FIX 1: registration trigger ─────────────────────────────────
-- Auto-creates a portal_users row whenever a new auth.users row is
-- created (i.e. whenever supabase.auth.signUp() succeeds). Pulls
-- full_name / company / phone / tier2_requested out of the signUp
-- call's `options.data` metadata (see js/portal.js initRegisterForm).

create or replace function public.handle_new_portal_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.portal_users (auth_id, email, full_name, company, phone, tier2_requested, tier2_request_date)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'company', ''),
    new.raw_user_meta_data->>'phone',
    coalesce((new.raw_user_meta_data->>'tier2_requested')::boolean, false),
    case when coalesce((new.raw_user_meta_data->>'tier2_requested')::boolean, false)
         then now() else null end
  )
  on conflict (email) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_portal_user();


-- ─── FIX 2: admin RLS recursion ──────────────────────────────────
-- Replaces the recursive "select 1 from portal_users where ..." check
-- inside portal_users' own admin policies with a SECURITY DEFINER
-- helper function, so the inner lookup bypasses RLS instead of
-- re-triggering it.

create or replace function public.is_portal_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from portal_users where auth_id = uid and role = 'admin'
  );
$$;

drop policy if exists "portal_users: admin select all" on portal_users;
create policy "portal_users: admin select all"
  on portal_users for select
  using (is_portal_admin(auth.uid()));

drop policy if exists "portal_users: admin update all" on portal_users;
create policy "portal_users: admin update all"
  on portal_users for update
  using (is_portal_admin(auth.uid()));

drop policy if exists "lead_activity: admin select all" on lead_activity;
create policy "lead_activity: admin select all"
  on lead_activity for select
  using (is_portal_admin(auth.uid()));

drop policy if exists "quote_requests: admin all" on quote_requests;
create policy "quote_requests: admin all"
  on quote_requests for all
  using (is_portal_admin(auth.uid()));


-- ─── FIX 1b (optional but recommended): backfill existing users ──
-- If anyone already signed up before this trigger existed, they have
-- an auth.users row with no matching portal_users row (this is also
-- the exact condition the app now detects and handles by signing the
-- user out — see js/auth.js requireTier()). Run this once to backfill
-- any such accounts instead of forcing them to re-register:

insert into public.portal_users (auth_id, email, full_name, company, phone)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
  coalesce(u.raw_user_meta_data->>'company', ''),
  u.raw_user_meta_data->>'phone'
from auth.users u
left join public.portal_users pu on pu.auth_id = u.id
where pu.id is null
on conflict (email) do nothing;


-- ─── Also required: disable email confirmation ───────────────────
-- Not SQL — a dashboard setting. supabase/schema.sql notes this too:
-- Authentication → Providers → Email → turn OFF "Confirm email".
-- With it ON, signUp() does not return a session, and the app's
-- immediate post-registration redirect (js/portal.js
-- initRegisterForm → /portal/dashboard-t1.html) would land on a page
-- that requireTier() correctly bounces back to /login because there
-- is no session yet — which can look like "registration doesn't work"
-- even though the portal_users row was created correctly.

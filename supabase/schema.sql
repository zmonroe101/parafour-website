-- ═══════════════════════════════════════════════════════════
--  Parafour Innovations — Contractor Portal Schema
--  Run this in the Supabase SQL editor for your project.
--  NOTE: Disable email confirmation in Auth settings for
--  the self-registration flow to work without a confirm step.
-- ═══════════════════════════════════════════════════════════

-- ── portal_users ──────────────────────────────────────────────
create table if not exists portal_users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique not null,
  full_name           text not null,
  company             text not null,
  phone               text,
  role                text not null default 'tier1',   -- tier1 | tier2 | admin
  status              text not null default 'active',  -- active | suspended
  application_notes   text,
  tier2_requested     boolean default false,
  tier2_request_date  timestamptz,
  created_at          timestamptz default now(),
  last_login          timestamptz,
  auth_id             uuid references auth.users(id) on delete cascade
);

create index if not exists portal_users_auth_id_idx on portal_users(auth_id);
create index if not exists portal_users_role_idx    on portal_users(role);

-- ── lead_activity ─────────────────────────────────────────────
create table if not exists lead_activity (
  id              uuid primary key default gen_random_uuid(),
  portal_user_id  uuid references portal_users(id) on delete set null,
  action          text not null,
  metadata        jsonb,
  created_at      timestamptz default now()
);

create index if not exists lead_activity_user_idx    on lead_activity(portal_user_id);
create index if not exists lead_activity_action_idx  on lead_activity(action);
create index if not exists lead_activity_created_idx on lead_activity(created_at desc);

-- ── quote_requests ────────────────────────────────────────────
create table if not exists quote_requests (
  id               uuid primary key default gen_random_uuid(),
  portal_user_id   uuid references portal_users(id) on delete set null,
  name             text not null,
  company          text not null,
  email            text not null,
  phone            text,
  product_interest text,
  quantity         text,
  distributor      text,
  message          text,
  status           text default 'new',  -- new | contacted | quoted | closed
  created_at       timestamptz default now()
);

create index if not exists quote_requests_status_idx  on quote_requests(status);
create index if not exists quote_requests_created_idx on quote_requests(created_at desc);

-- ═══════════════════════════════════════════════════════════
--  Registration trigger — auto-creates the portal_users row
--  Without this, supabase.auth.signUp() creates an auth.users row but
--  NOTHING inserts into portal_users, so new accounts have no profile
--  (dashboard, admin views, and RLS-gated queries all break for them).
-- ═══════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════
--  Row Level Security
-- ═══════════════════════════════════════════════════════════

alter table portal_users    enable row level security;
alter table lead_activity   enable row level security;
alter table quote_requests  enable row level security;

-- ── admin-check helper (avoids RLS self-recursion, see note below) ──
--
-- A policy ON portal_users whose USING clause runs
--   "select 1 from portal_users where ..."
-- re-triggers portal_users' own RLS while evaluating that subquery,
-- which re-triggers the same policy, etc. — Postgres detects this and
-- raises "infinite recursion detected in policy for relation
-- portal_users", which made every admin-gated query (the whole admin
-- dashboard) fail. Wrapping the check in a SECURITY DEFINER function
-- runs the inner lookup as the function owner, bypassing RLS instead
-- of recursing into it.
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

-- ── portal_users policies ─────────────────────────────────────

-- Users can view their own record
create policy "portal_users: self select"
  on portal_users for select
  using (auth.uid() = auth_id);

-- Users can insert their own record (during registration)
create policy "portal_users: self insert"
  on portal_users for insert
  with check (auth.uid() = auth_id);

-- Users can update their own record
create policy "portal_users: self update"
  on portal_users for update
  using (auth.uid() = auth_id);

-- Admins can read all records
create policy "portal_users: admin select all"
  on portal_users for select
  using (is_portal_admin(auth.uid()));

-- Admins can update all records (approve/reject/role change)
create policy "portal_users: admin update all"
  on portal_users for update
  using (is_portal_admin(auth.uid()));

-- ── lead_activity policies ────────────────────────────────────

create policy "lead_activity: self insert"
  on lead_activity for insert
  with check (
    portal_user_id in (
      select id from portal_users where auth_id = auth.uid()
    )
  );

create policy "lead_activity: self select"
  on lead_activity for select
  using (
    portal_user_id in (
      select id from portal_users where auth_id = auth.uid()
    )
  );

create policy "lead_activity: admin select all"
  on lead_activity for select
  using (is_portal_admin(auth.uid()));

-- ── quote_requests policies ───────────────────────────────────

create policy "quote_requests: self insert"
  on quote_requests for insert
  with check (
    portal_user_id in (
      select id from portal_users where auth_id = auth.uid()
    )
  );

create policy "quote_requests: self select"
  on quote_requests for select
  using (
    portal_user_id in (
      select id from portal_users where auth_id = auth.uid()
    )
  );

create policy "quote_requests: admin all"
  on quote_requests for all
  using (is_portal_admin(auth.uid()));

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
--  Row Level Security
-- ═══════════════════════════════════════════════════════════

alter table portal_users    enable row level security;
alter table lead_activity   enable row level security;
alter table quote_requests  enable row level security;

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
  using (
    exists (
      select 1 from portal_users
      where auth_id = auth.uid() and role = 'admin'
    )
  );

-- Admins can update all records (approve/reject/role change)
create policy "portal_users: admin update all"
  on portal_users for update
  using (
    exists (
      select 1 from portal_users
      where auth_id = auth.uid() and role = 'admin'
    )
  );

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
  using (
    exists (
      select 1 from portal_users
      where auth_id = auth.uid() and role = 'admin'
    )
  );

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
  using (
    exists (
      select 1 from portal_users
      where auth_id = auth.uid() and role = 'admin'
    )
  );

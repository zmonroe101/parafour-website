-- ═══════════════════════════════════════════════════════════════
--  Parafour Portal — Subscription Model Schema
--  Run this in the Supabase SQL editor AFTER schema.sql (and after
--  fix-registration-trigger.sql if that hasn't been applied yet).
--  The whole file is idempotent — safe to re-run.
--
--  Covers all four monetization features:
--    1. Stripe subscription billing  (portal_users columns)
--    2. Tiered access control        (no SQL needed — client-side +
--                                     column-protection trigger below)
--    3. End-user intro training      (training_modules,
--                                     training_quiz_questions,
--                                     training_progress + seeds)
--    4. Affiliate system             (affiliate_links,
--                                     affiliate_conversions + RPCs)
--
--  NOTE: subscription tiers (free|pro|partner) are ORTHOGONAL to the
--  existing role system (tier1|tier2|admin). A tier1 customer or a
--  tier2 contractor can each hold any subscription. Admins bypass
--  subscription gates in the client.
-- ═══════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
--  1. STRIPE SUBSCRIPTION BILLING
-- ═══════════════════════════════════════════════════════════════

alter table portal_users add column if not exists subscription_tier               text not null default 'free';  -- free | pro | partner
alter table portal_users add column if not exists stripe_customer_id              text;
alter table portal_users add column if not exists stripe_subscription_id          text;
alter table portal_users add column if not exists subscription_status             text;                          -- active | trialing | past_due | canceled | ...
alter table portal_users add column if not exists subscription_current_period_end timestamptz;

create index if not exists portal_users_subscription_tier_idx on portal_users(subscription_tier);
create index if not exists portal_users_stripe_customer_idx   on portal_users(stripe_customer_id);

-- ── Protect billing columns from self-service tampering ──────────
-- The existing "portal_users: self update" RLS policy lets a user
-- update their OWN row with no column restrictions — without this
-- trigger, anyone could PATCH subscription_tier='partner' through the
-- public REST API. Only the Stripe webhook (service_role) and admins
-- may change billing fields. SECURITY DEFINER + is_portal_admin()
-- matches the established anti-recursion pattern in schema.sql.
create or replace function public.protect_subscription_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.subscription_tier               is distinct from old.subscription_tier
   or new.stripe_customer_id              is distinct from old.stripe_customer_id
   or new.stripe_subscription_id          is distinct from old.stripe_subscription_id
   or new.subscription_status             is distinct from old.subscription_status
   or new.subscription_current_period_end is distinct from old.subscription_current_period_end) then
    if not (coalesce(auth.role(), '') = 'service_role' or is_portal_admin(auth.uid())) then
      raise exception 'Subscription fields can only be modified by billing webhooks or admins';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_subscription_columns_trg on portal_users;
create trigger protect_subscription_columns_trg
  before update on portal_users
  for each row execute function public.protect_subscription_columns();

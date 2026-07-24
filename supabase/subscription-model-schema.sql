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


-- ═══════════════════════════════════════════════════════════════
--  3. END-USER INTRO TRAINING
--  (5 modules + quizzes + progress + auto-certificate)
--  Lesson body content lives client-side in js/training-content.js;
--  module metadata and quiz questions live here so progress,
--  reporting, and future content tiers stay queryable.
-- ═══════════════════════════════════════════════════════════════

create table if not exists training_modules (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  description    text,
  video_url      text,                 -- placeholder for future video embeds
  pdf_url        text,                 -- placeholder for future PDF downloads
  required_tier  text default 'free',  -- subscription tier: free | pro | partner
  order_index    integer,
  created_at     timestamptz default now()
);

create table if not exists training_quiz_questions (
  id             uuid primary key default gen_random_uuid(),
  module_id      uuid references training_modules(id) on delete cascade,
  question       text not null,
  options        jsonb not null,      -- array of answer strings
  correct_index  integer not null,    -- 0-based index into options
  order_index    integer,
  created_at     timestamptz default now()
);

create table if not exists training_progress (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references portal_users(id) on delete cascade,
  module_id     uuid references training_modules(id) on delete cascade,
  status        text default 'not_started',  -- not_started | in_progress | completed
  quiz_score    integer,                     -- percentage 0-100
  completed_at  timestamptz,
  created_at    timestamptz default now(),
  unique(user_id, module_id)
);

create index if not exists training_progress_user_idx   on training_progress(user_id);
create index if not exists training_progress_module_idx on training_progress(module_id);
create index if not exists training_quiz_module_idx     on training_quiz_questions(module_id);

-- ── RLS ──────────────────────────────────────────────────────────

alter table training_modules        enable row level security;
alter table training_quiz_questions enable row level security;
alter table training_progress       enable row level security;

drop policy if exists "training_modules: authenticated select" on training_modules;
create policy "training_modules: authenticated select"
  on training_modules for select
  to authenticated
  using (true);

drop policy if exists "training_modules: admin all" on training_modules;
create policy "training_modules: admin all"
  on training_modules for all
  using (is_portal_admin(auth.uid()));

drop policy if exists "training_quiz_questions: authenticated select" on training_quiz_questions;
create policy "training_quiz_questions: authenticated select"
  on training_quiz_questions for select
  to authenticated
  using (true);

drop policy if exists "training_quiz_questions: admin all" on training_quiz_questions;
create policy "training_quiz_questions: admin all"
  on training_quiz_questions for all
  using (is_portal_admin(auth.uid()));

drop policy if exists "training_progress: self insert" on training_progress;
create policy "training_progress: self insert"
  on training_progress for insert
  with check (user_id in (select id from portal_users where auth_id = auth.uid()));

drop policy if exists "training_progress: self select" on training_progress;
create policy "training_progress: self select"
  on training_progress for select
  using (user_id in (select id from portal_users where auth_id = auth.uid()));

drop policy if exists "training_progress: self update" on training_progress;
create policy "training_progress: self update"
  on training_progress for update
  using (user_id in (select id from portal_users where auth_id = auth.uid()));

drop policy if exists "training_progress: admin select all" on training_progress;
create policy "training_progress: admin select all"
  on training_progress for select
  using (is_portal_admin(auth.uid()));

-- ── Seed: 5 intro modules (fixed UUIDs referenced by the client) ──

insert into training_modules (id, title, description, required_tier, order_index) values
  ('a0000000-0000-4000-8000-000000000001', 'What to Order',
   'Interactive product selector — answer a few questions about your site and get a P4 Series configuration recommendation.', 'free', 1),
  ('a0000000-0000-4000-8000-000000000002', 'Understanding LPG Dispensers',
   'What an LPG dispenser is, how it works, its safety features, and the industry standards that govern it.', 'free', 2),
  ('a0000000-0000-4000-8000-000000000003', 'Installation Basics',
   'What professional installation involves, realistic timelines, and the inspections required before first fill.', 'free', 3),
  ('a0000000-0000-4000-8000-000000000004', 'Operation & Maintenance',
   'Daily, monthly, and annual care that keeps a P4 Series dispenser accurate, safe, and out of emergency service.', 'free', 4),
  ('a0000000-0000-4000-8000-000000000005', 'Troubleshooting Guide',
   'Self-service diagnosis for the most common dispensing problems — and when to stop and call support.', 'free', 5)
on conflict (id) do update
  set title = excluded.title,
      description = excluded.description,
      required_tier = excluded.required_tier,
      order_index = excluded.order_index;

-- ── Seed: quiz questions (pass mark is 80%, graded client-side) ──

insert into training_quiz_questions (id, module_id, question, options, correct_index, order_index) values
  -- Module 1: What to Order (5)
  ('b0000000-0000-4000-8000-000000000101', 'a0000000-0000-4000-8000-000000000001',
   'Which factor most directly determines the pump and dispenser capacity you need?',
   '["The color of the cabinet", "The required flow rate in gallons per minute (GPM)", "The brand of your delivery truck", "The length of the fueling island"]', 1, 1),
  ('b0000000-0000-4000-8000-000000000102', 'a0000000-0000-4000-8000-000000000001',
   'A dual-nozzle configuration is the right choice when…',
   '["You want a backup nozzle in case one breaks", "You need to fuel two vehicles or fill points at the same time", "Your tank is more than 50 feet away", "You only fill small forklift cylinders"]', 1, 2),
  ('b0000000-0000-4000-8000-000000000103', 'a0000000-0000-4000-8000-000000000001',
   'You plan to sell autogas to the public by the gallon. Which certification must your dispenser''s metering system carry?',
   '["ISO 9001", "NTEP Category 1 (legal-for-trade)", "ENERGY STAR", "OSHA 1910"]', 1, 3),
  ('b0000000-0000-4000-8000-000000000104', 'a0000000-0000-4000-8000-000000000001',
   'Your site only has 110V single-phase power available. What should you confirm before ordering?',
   '["That the dispenser electronics and pump motor are rated for your available voltage", "Nothing — all dispensers run on any voltage", "That you have three-phase 480V service", "That the dispenser has a solar backup"]', 0, 4),
  ('b0000000-0000-4000-8000-000000000105', 'a0000000-0000-4000-8000-000000000001',
   'The storage tank sits far from the fueling island. Which configuration should you consider?',
   '["Retail configuration", "Standard configuration with a longer hose", "Remote dispenser configuration (pump at the tank, dispenser at the island)", "Two standard dispensers wired together"]', 2, 5),

  -- Module 2: Understanding LPG Dispensers (5)
  ('b0000000-0000-4000-8000-000000000201', 'a0000000-0000-4000-8000-000000000002',
   'What is the primary job of the meter inside an LPG dispenser?',
   '["To cool the propane before dispensing", "To accurately measure the volume of liquid LPG dispensed", "To add odorant to the gas", "To regulate tank pressure"]', 1, 1),
  ('b0000000-0000-4000-8000-000000000202', 'a0000000-0000-4000-8000-000000000002',
   'Why does an LPG dispenser use a differential (bypass) valve?',
   '["To keep the correct pressure differential so liquid — not vapor — passes through the meter", "To let customers select octane grades", "To shut the dispenser off at night", "To drain the hose after each fill"]', 0, 2),
  ('b0000000-0000-4000-8000-000000000203', 'a0000000-0000-4000-8000-000000000002',
   'Which standard governs LPG storage and handling systems in the United States?',
   '["NFPA 58", "SAE J1772", "NEC Article 210 only", "ASTM D975"]', 0, 3),
  ('b0000000-0000-4000-8000-000000000204', 'a0000000-0000-4000-8000-000000000002',
   'What does the breakaway coupling on the hose do?',
   '["Increases flow rate on demand", "Separates cleanly and seals both ends if a vehicle drives off with the nozzle attached", "Warms the hose in winter", "Filters debris out of the fuel"]', 1, 4),
  ('b0000000-0000-4000-8000-000000000205', 'a0000000-0000-4000-8000-000000000002',
   'What is the key difference between an LPG dispenser and a gasoline dispenser?',
   '["LPG dispensers have no meter", "LPG is stored and dispensed as a pressurized liquefied gas, so every component must be sealed and pressure-rated", "Gasoline dispensers are more dangerous", "There is no difference"]', 1, 5),

  -- Module 3: Installation Basics (5)
  ('b0000000-0000-4000-8000-000000000301', 'a0000000-0000-4000-8000-000000000003',
   'Who should perform the mechanical and gas-side installation of an LPG dispenser?',
   '["Any general handyman", "The site owner, to save money", "A licensed/certified LPG technician familiar with NFPA 58 and local codes", "The freight carrier that delivers it"]', 2, 1),
  ('b0000000-0000-4000-8000-000000000302', 'a0000000-0000-4000-8000-000000000003',
   'With the site properly prepared (pad, power, piping), how long does a typical dispenser installation take?',
   '["2–4 hours", "15 minutes", "2–3 weeks", "At least a month"]', 0, 2),
  ('b0000000-0000-4000-8000-000000000303', 'a0000000-0000-4000-8000-000000000003',
   'Before selling fuel to the public, which inspection must the dispenser pass?',
   '["A fire drill", "Weights & measures certification of the meter (plus AHJ/fire-code sign-off)", "An EPA emissions test", "No inspection is required"]', 1, 3),
  ('b0000000-0000-4000-8000-000000000304', 'a0000000-0000-4000-8000-000000000003',
   'Which of these is one of the most common installation mistakes?',
   '["Painting the cabinet the wrong color", "Undersizing the pump or supply piping, causing permanently slow dispensing", "Installing the dispenser too close to the cash register", "Using stainless-steel fittings"]', 1, 4),
  ('b0000000-0000-4000-8000-000000000305', 'a0000000-0000-4000-8000-000000000003',
   'Why are grounding and bonding required during installation?',
   '["To improve Wi-Fi reception", "To prevent static discharge from igniting propane vapor", "To make the display brighter", "They are optional cosmetic steps"]', 1, 5),

  -- Module 4: Operation & Maintenance (5)
  ('b0000000-0000-4000-8000-000000000401', 'a0000000-0000-4000-8000-000000000004',
   'Which of these belongs on the DAILY operation checklist?',
   '["Full meter recalibration", "Visual inspection of hose, nozzle, and connections for leaks or damage", "Replacing the inline filter", "Repainting safety decals"]', 1, 1),
  ('b0000000-0000-4000-8000-000000000402', 'a0000000-0000-4000-8000-000000000004',
   'How often should the inline fuel filter be checked?',
   '["Monthly — and replaced when pressure drop or flow rate indicates clogging", "Every 10 years", "Only when the dispenser stops working entirely", "Never — filters are lifetime parts"]', 0, 2),
  ('b0000000-0000-4000-8000-000000000403', 'a0000000-0000-4000-8000-000000000004',
   'Which task is part of ANNUAL maintenance?',
   '["Meter proving/calibration check by a qualified technician", "Wiping down the cabinet", "Checking the display is on", "Topping up the storage tank"]', 0, 3),
  ('b0000000-0000-4000-8000-000000000404', 'a0000000-0000-4000-8000-000000000004',
   'Which warning sign means you should schedule service rather than keep operating?',
   '["A steadily declining flow rate or repeating error codes", "A dusty cabinet", "A faded price sticker", "Cold weather"]', 0, 4),
  ('b0000000-0000-4000-8000-000000000405', 'a0000000-0000-4000-8000-000000000004',
   'What is the main cold-weather (winterization) concern for LPG dispensing?',
   '["Propane freezes solid in the lines", "Lower tank pressure and moisture in the system can slow or disrupt dispensing — keep regulators, filters, and any cabinet heaters serviced", "The display changes language", "Nothing changes in winter"]', 1, 5),

  -- Module 5: Troubleshooting Guide (10)
  ('b0000000-0000-4000-8000-000000000501', 'a0000000-0000-4000-8000-000000000005',
   'No fuel dispenses but the display is on. What should you check FIRST?',
   '["Replace the meter", "Tank liquid level and that all manual shutoff valves are open", "Rewire the pump motor", "Call the fire department"]', 1, 1),
  ('b0000000-0000-4000-8000-000000000502', 'a0000000-0000-4000-8000-000000000005',
   'Flow stops suddenly right after opening a valve quickly. The likely cause is…',
   '["A dead battery", "The excess-flow valve slammed shut — close the valve, wait, and reopen it slowly", "An empty hose", "A blown fuse"]', 1, 2),
  ('b0000000-0000-4000-8000-000000000503', 'a0000000-0000-4000-8000-000000000005',
   'What is the most common cause of SLOW dispensing?',
   '["A clogged inline filter or strainer", "The nozzle is too shiny", "The tank is too full", "The display brightness is low"]', 0, 3),
  ('b0000000-0000-4000-8000-000000000504', 'a0000000-0000-4000-8000-000000000005',
   'Erratic flow and meter creep on a hot day most likely indicate…',
   '["Vapor lock — vapor is reaching the meter instead of liquid", "A software update in progress", "Too much odorant", "A stuck keypad"]', 0, 4),
  ('b0000000-0000-4000-8000-000000000505', 'a0000000-0000-4000-8000-000000000005',
   'The pump won''t start at all. What is the first ELECTRICAL check?',
   '["The circuit breaker / power supply to the pump motor", "The hose length", "The nozzle o-ring", "The tank paint"]', 0, 5),
  ('b0000000-0000-4000-8000-000000000506', 'a0000000-0000-4000-8000-000000000005',
   'A "pulser error" on the register/calculator display points to…',
   '["An empty tank", "A fault in the meter''s pulse output signal or its wiring", "Wrong fuel price programmed", "A tripped breakaway"]', 1, 6),
  ('b0000000-0000-4000-8000-000000000507', 'a0000000-0000-4000-8000-000000000005',
   'What does a "no-flow timeout" protection do?',
   '["Speeds up the pump", "Shuts the dispenser off automatically when the pump runs but no flow is measured", "Locks the keypad after hours", "Prints a receipt"]', 1, 7),
  ('b0000000-0000-4000-8000-000000000508', 'a0000000-0000-4000-8000-000000000005',
   'You smell gas at the dispenser. What is the correct response?',
   '["Keep dispensing but watch carefully", "Stop immediately, hit the emergency stop, isolate the supply, keep ignition sources away, and call for service", "Spray water on the dispenser", "Restart the dispenser to clear it"]', 1, 8),
  ('b0000000-0000-4000-8000-000000000509', 'a0000000-0000-4000-8000-000000000005',
   'When should dispensing hoses be replaced?',
   '["Only when they burst", "Per manufacturer date codes and whenever inspection shows cuts, bulges, or soft spots", "Every week", "Never, if they still look clean"]', 1, 9),
  ('b0000000-0000-4000-8000-000000000510', 'a0000000-0000-4000-8000-000000000005',
   'Which problem should you NOT attempt to fix yourself and instead call support/service?',
   '["Adjusting display brightness", "Resetting a tripped breaker", "Anything involving leaks or opening pressurized LPG components", "Wiping down the nozzle"]', 2, 10)
on conflict (id) do update
  set question = excluded.question,
      options = excluded.options,
      correct_index = excluded.correct_index,
      order_index = excluded.order_index;

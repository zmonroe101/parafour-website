# Parafour Customer Portal — Fixes Log

Local-only fixes. Nothing has been deployed or pushed. A pre-fix backup
exists at `C:\Users\zaker\Desktop\backups\parafour-website-backup-20260723-175742`.

---

## Bug 1 — Redirect loop on `/portal/index.html`

**Root cause:** `portal/index.html`, `portal/login.html`, and
`js/auth.js`'s `requireTier()` all independently looked up the caller's
`portal_users` row to decide where to send them. When a Supabase auth
session was valid but **no matching `portal_users` row existed** (which,
before Bug 2 was fixed, was true for *every* newly-registered account),
each of these checkpoints defaulted to assuming role `'tier1'` and
redirected to a dashboard — but the dashboard pages (`dashboard-t1.html`,
`dashboard-t2.html`) then did their own redundant `getPortalUser()` check,
found nothing, and bounced back to `/portal/login.html` using
`window.location.href` (not `.replace()`), while leaving the session
intact. `login.html` would then see the still-valid session, assume
`'tier1'` again, and send the browser right back to the dashboard —
an infinite loop between `login.html` and the dashboard pages.

Using `.replace()` instead of `.href` (as originally suggested) would
only have stopped the loop from polluting browser history — it would
**not** have stopped the infinite navigation itself, because the actual
defect is that nothing ever terminates the cycle when the account/session
pairing is invalid.

**Fix:** Every checkpoint that discovers "valid session, no `portal_users`
row" now calls `supabase.auth.signOut()` **before** redirecting to login.
This clears the session, so when `login.html` re-checks, it correctly
sees no user and stays put (showing an error banner via
`?error=account_not_found`) instead of bouncing back to a dashboard.

- `js/auth.js` — `requireTier()`, lines ~55-67 (before/after below)
- `portal/index.html` — lines 85-99
- `portal/login.html` — lines 120-134 (pre-check block)
- `portal/dashboard-t1.html` / `dashboard-t2.html` — removed the redundant
  second `getPortalUser()` check entirely; now rely solely on
  `requireTier()`, which already has the fix (and already used
  `.replace()`, unlike the dashboards' old fallback).

**Before** (`js/auth.js`):
```js
const portalUser = await getPortalUser();
if (!portalUser) {
  window.location.replace('/portal/login.html');
  return null;
}
```

**After:**
```js
const portalUser = await getPortalUser();
if (!portalUser) {
  await supabase.auth.signOut();
  window.location.replace('/portal/login.html?error=account_not_found');
  return null;
}
```

**Verify (code-read, done):** Traced every page that redirects based on
`portal_users` lookup (`index.html`, `login.html`, `dashboard-t1.html`,
`dashboard-t2.html`, `apply.html` via `requireTier`, both admin pages via
`requireTier`) — all now funnel through the same sign-out-then-redirect
path when the row is missing, so there is no longer a cycle with no exit.

**Verify (needs live environment — you):** Register a real account, then
manually delete its row from `portal_users` in the Supabase table editor
while leaving the `auth.users` row and browser session intact. Reload
`/portal/`. Expected: lands on `/portal/login.html` with the "couldn't
find your portal account" banner, not a loop.

---

## Bug 2 — Registration not creating a `portal_users` row

**Root cause:** `js/portal.js` `initRegisterForm()` only calls
`supabase.auth.signUp()`. Nothing — client-side or server-side — ever
inserted the corresponding row into `portal_users`. `supabase/schema.sql`
defined an RLS policy allowing a user to insert their *own* row
(`"portal_users: self insert"`), but no code path ever exercised it, and
there was no database trigger either. Confirmed by reading
`supabase/schema.sql` end-to-end: no `CREATE TRIGGER` / `CREATE FUNCTION`
existed anywhere in the file.

**Fix:** Added a `SECURITY DEFINER` trigger function
`public.handle_new_portal_user()` + trigger `on_auth_user_created` on
`auth.users`, which inserts a matching `portal_users` row using the
metadata already passed via `signUp({ options: { data: {...} } })` in
`js/portal.js` (`full_name`, `company`, `phone`, `tier2_requested`).

- Added to `supabase/schema.sql` (so a fresh install gets it automatically)
- Also written as a standalone, idempotent script:
  **`supabase/fix-registration-trigger.sql`** — paste this into the
  Supabase SQL editor and run it. Also includes a one-time backfill
  query for any accounts that registered before this trigger existed.

```sql
create or replace function public.handle_new_portal_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.portal_users (auth_id, email, full_name, company, phone, tier2_requested, tier2_request_date)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'company', ''),
    new.raw_user_meta_data->>'phone',
    coalesce((new.raw_user_meta_data->>'tier2_requested')::boolean, false),
    case when coalesce((new.raw_user_meta_data->>'tier2_requested')::boolean, false) then now() else null end
  )
  on conflict (email) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_portal_user();
```

**⚠️ ACTION REQUIRED — I cannot run this against your live Supabase
project.** You must open the Supabase SQL editor for project
`rzwczgdbkmdwpyrlcueo` and run `supabase/fix-registration-trigger.sql`
yourself. Until you do, new registrations will still not create a
`portal_users` row.

**Verify (needs live environment — you):** Register a brand-new test
account through `/portal/register.html`, then check the `portal_users`
table in Supabase — a row should appear immediately with matching
`full_name`/`company`/`email`, and the browser should land on
`dashboard-t1.html` without bouncing to login.

---

## Bug 3 — Session not persisting after refresh

**Root cause investigated, not a literal misconfiguration:**
`js/auth.js`'s client creation already had the correct options
(`persistSession: true`, `storage: window.localStorage`,
`storageKey: 'parafour-portal-auth'`, `autoRefreshToken: true`,
`detectSessionInUrl: true`), and every session check in the codebase
(`getCurrentUser`, `requireAuth`, `requireTier`, the pre-checks on
`index.html`/`login.html`) already correctly `await`s
`supabase.auth.getSession()` before making a decision. No other script
touches `localStorage`/`sessionStorage`, and there's no service worker or
caching header interfering (`_headers` sets `Cache-Control: no-store` for
`/portal/*`).

**What was actually happening:** because of Bug 2 (no `portal_users` row
ever got created), every refresh of a dashboard page hit the "valid
session, but `getPortalUser()` returns null" branch — and the dashboards'
old code (`window.location.href = '/portal/login.html'`) treated that
exactly like "you're logged out," bouncing the user back to login. To an
end user this looks identical to "my session isn't persisting," even
though the Supabase auth session itself was intact the whole time.

**Fix:** Fixing Bug 2 (the trigger) means `portal_users` always exists
after registration, so this path is no longer hit in normal use. I also
hardened the fallback (see Bug 1) so that if a `portal_users` row is ever
legitimately missing for some other reason, the app now explicitly signs
the user out and shows a clear message, rather than presenting a
confusing "silently logged out on refresh" experience.

**Verify (needs live environment — you):** After running the SQL fix and
registering/logging in, refresh `dashboard-t1.html` (or `-t2`) several
times, including a hard refresh (Ctrl+Shift+R) and after closing/reopening
the browser tab. Session should persist in all cases — check
Application → Local Storage → `parafour-portal-auth` in devtools.

---

## Bug 4 — Admin dashboard incomplete

Two distinct problems found:

### 4a. Admins were locked out entirely

`js/auth.js` had `const ADMIN_EMAILS = ['zak@parafour.com'];` and
`requireTier('admin')` required **both** `role === 'admin'` **and**
`ADMIN_EMAILS.includes(user.email)`. `zak@parafour.com` is not a Parafour
admin — Zak Monroe is the owner of a *different* client (Heine Propane);
this looks like a leftover from a shared template. Parafour's real admins
are Robin Parsons and Jake Sutton (`about/index.html`), whose emails
aren't in that list, so **no real admin could ever pass this check**,
regardless of their `role` in the database.

**Fix:** Removed `ADMIN_EMAILS` and the email check entirely. `role` is
the authoritative field (per the code's own pre-existing comment) and is
already protected by RLS — only an existing admin can promote another
user to `role = 'admin'` (`adminSetRole()` is only reachable from
`requireTier('admin')`-gated pages). `js/auth.js`, `requireTier()`.

### 4b. Admin queries would fail outright (RLS infinite recursion)

`supabase/schema.sql`'s `"portal_users: admin select all"` and
`"...admin update all"` policies were defined as:
```sql
using (exists (select 1 from portal_users where auth_id = auth.uid() and role = 'admin'))
```
A policy **on** `portal_users` whose check queries `portal_users` again
triggers RLS evaluation recursively on itself. Postgres detects this and
raises `"infinite recursion detected in policy for relation
portal_users"` — which would make every admin-gated read/write on
`portal_users` fail, i.e. the entire admin dashboard and user-management
page.

**Fix:** Added `public.is_portal_admin(uid)`, a `SECURITY DEFINER SQL`
function, and rewrote the four admin policies (`portal_users` select +
update, `lead_activity` select, `quote_requests` all) to call it instead
of inlining the self-referential subquery. Running as the function
owner bypasses RLS for the inner lookup instead of re-triggering it —
this is the standard Supabase-documented pattern for this exact error.
Included in both `supabase/schema.sql` and
`supabase/fix-registration-trigger.sql` (same file as the trigger fix —
**ACTION REQUIRED**, see Bug 2).

### 4c. JS wiring (already present, verified correct)

`portal/admin/index.html` and `js/portal.js`'s `loadAdminStats()`,
`loadPendingApps()`, `loadRecentRegistrations()`, `loadRecentQuotes()`,
`adminApprove()`, `adminReject()`, `adminViewApp()`, `adminUpdateQuote()`
were already implemented and correctly wired (this page doesn't have the
DOMContentLoaded-timing bug — see Feature section below — because it
attaches listeners to elements that already exist in the static HTML,
not ones created after the event). No functional changes needed once
4a/4b were fixed; these were previously failing silently due to the RLS
recursion in 4b.

**Verify (code-read, done):** Read `portal/admin/index.html` end-to-end;
every `id` referenced by `js/portal.js`'s admin loaders exists in the
HTML and vice versa.

**Verify (needs live environment — you):** After running the SQL fix
(4b) and confirming Robin's/Jake's `portal_users.role = 'admin'`, log in
as an admin and load `/portal/admin/`. Stat cards, pending applications
table, recent registrations, and recent quotes should all populate
without console errors.

---

## Features completed

### `portal/admin/index.html` — KPI cards, recent users, Tier 2 approvals
Already implemented in `js/portal.js` prior to this pass; unblocked by
fixing 4a/4b above. No file changes needed here.

### `portal/admin/users.html` — user management
Already had: load all users, filter by role/status, search, role-change
dropdown, CSV export. **Added:** an inline "Tier 2 pending" badge and
Approve/Reject buttons per spec bullet ("Tier 2 approval flow") directly
in the user table, reusing the existing `adminApprove()` / `adminReject()`
functions (previously only reachable from the separate admin index page).
`js/portal.js` → `loadAllUsers()`.

### `portal/apply.html` — Tier 2 application wiring
Found **three** bugs that meant this form never worked at all:
1. `document.addEventListener('DOMContentLoaded', initApplyForm)` was
   called *inside* an async IIFE, after `await requireTier(...)` — by
   the time that line ran, `DOMContentLoaded` had already fired (this
   script sits at the very end of the document), so the listener never
   fired and the submit handler was never attached. **Fixed:** call
   `initApplyForm()` directly.
2. `initApplyForm()`'s submit handler read `document.getElementById('applyError')`,
   but the actual element in `apply.html` is `id="applyAlert"` — even if
   the handler had been attached, the very first line
   (`errorEl.classList.remove('visible')`) would throw
   `TypeError: Cannot read properties of null`, aborting the submit
   before the database update ever ran. **Fixed:** use `applyAlert` and
   the same `portal-alert`/`portal-alert-error`/`-success` class pattern
   already used by the quote form, for consistency.
3. The distributor-toggle listener referenced `document.getElementById('distributorWrap')`,
   but the real element id is `distNameGroup`. **Fixed** the id
   reference. Also removed a second, duplicate copy of the same toggle
   logic that had been added directly in `apply.html`'s inline script
   (harmless but redundant now that `initApplyForm()`'s copy actually
   runs).
4. The form fields in `apply.html` had `id`s but no `name` attributes,
   while `initApplyForm()` read old field names (`install_type`,
   `dispensers_12mo`, `subscription_interest`) that don't exist anywhere
   in the current form (leftover from an earlier version). **Fixed:**
   added matching `name` attributes to the real fields (`business_name`,
   `years_experience`, `role_title`, `works_with_dist`,
   `distributor_name`, `experience`, `why_applying`) and rewrote
   `initApplyForm()`'s `appData` object and `adminViewApp()`'s display
   text to match.
5. **Added:** dashboard now shows "Tier 2 Application Pending" (see
   below) and `apply.html` itself shows the confirmation state instead
   of a blank form if the user re-visits after already applying
   (`portalUser.tier2_requested`).

`portal/dashboard-t1.html` — added an "Application Pending" banner
(`#pendingBanner`) that replaces the "Apply for Tier 2" banner
(`#upgradeBanner`) once `portalUser.tier2_requested` is true.

### `portal/login.html` — Forgot password
`js/portal.js`'s forgot-password handler looked for
`document.getElementById('forgotPassword')`, but the button in
`login.html` had `id="forgotBtn"` — the click handler was never
attached. **Fixed** by renaming the HTML id to `forgotPassword` to match
(kept the JS name since `resetPasswordForEmail()`'s call itself was
already correct, including a sensible `redirectTo`).

Also **added** the missing second half of the flow: there was no way for
a user to actually set a new password after clicking the email link —
`resetPasswordForEmail()` only sends the email. Added a "Set New
Password" panel on `login.html` (shown when the page detects
`type=recovery` in the URL, which Supabase appends to the
`redirectTo` link) with its own form, wired to
`supabase.auth.updateUser({ password })` via a new
`initResetPasswordForm()` in `js/portal.js`.

---

## Additional bugs found and fixed (not on the original list)

- **`js/auth.js` `ADMIN_EMAILS` allowlist** — see Bug 4a above; this was
  actively blocking the real admins, not just a redundant guard.
- **RLS infinite recursion on `portal_users` admin policies** — see Bug
  4b above; would have made the admin dashboard fail even after all JS
  was wired correctly.
- **`dashboard-t1.html` / `dashboard-t2.html` quote form never wired** —
  same `DOMContentLoaded`-after-await timing bug as `apply.html` item 1
  above (`document.addEventListener('DOMContentLoaded', initQuoteForm)`
  called after `await requireTier(...)` / `await getPortalUser()`).
  **Fixed:** call `initQuoteForm()` directly in both files.
- **`apply.html` id/name mismatches** — see Features section above.

---

## Spec's 7-point testing checklist

| # | Item | Status |
|---|------|--------|
| 1 | Registration → `portal_users` row created → redirects to Tier 1 dashboard | **Needs live testing.** Trigger SQL fixed and code-reviewed correct, but requires running `supabase/fix-registration-trigger.sql` against the live DB (I cannot do this) and then a real signup to confirm. |
| 2 | Login → redirects to correct dashboard → session persists after refresh | **Needs live testing.** Code-reviewed correct (see Bug 3); needs confirmation against live Supabase + real session. |
| 3 | Tier 2 application → `tier2_requested=true` → dashboard shows "Pending" | **Needs live testing.** Form wiring bugs fixed and code-reviewed; needs a live submit to confirm the DB write and the dashboard banner render together. |
| 4 | Admin login → see all users → approve Tier 2 → user role updates | **Needs live testing.** Requires running the RLS fix SQL (Bug 4b) first — cannot verify RLS behavior without a live Postgres instance. |
| 5 | Password reset → receive email → reset works | **Needs live testing.** Requires a real outbound email (Supabase Auth email delivery) and clicking the real link; the landing-page recovery flow was code-reviewed but the actual email send/receive cannot be tested from this environment. |
| 6 | Mobile responsive (375px–1920px) | **Not modified in this pass** — no layout/CSS changes were made to any page; existing responsive CSS classes were reused as-is. Recommend a quick manual pass at 375px on `login.html` (now has two stacked `.auth-card`s, only one visible at a time) and `apply.html`/dashboard banners (new pending banner). |
| 7 | Zero console errors | **Partially verified.** Opened changed pages as static files locally — Supabase network calls fail as expected (no live backend reachable from this environment) but no JS syntax/reference errors were found in code review. Needs a live-backend browser check to confirm zero console errors end-to-end. |

---

## Files changed

- `js/auth.js` — redirect-loop root cause fix, removed broken admin email allowlist
- `js/portal.js` — apply.html field/id fixes, reset-password form, admin users.html Tier 2 approve/reject, adminViewApp() field names
- `portal/index.html` — orphaned-session handling
- `portal/login.html` — forgot-password id fix, error/success banners, password-recovery UI
- `portal/apply.html` — form field names, DOMContentLoaded fix, pending-state display
- `portal/dashboard-t1.html` — DOMContentLoaded fix, Application Pending banner, simplified auth check
- `portal/dashboard-t2.html` — DOMContentLoaded fix, simplified auth check
- `supabase/schema.sql` — registration trigger, admin RLS recursion fix
- `supabase/fix-registration-trigger.sql` *(new)* — standalone script for the Supabase SQL editor; **you must run this**

## SQL you must run

Open the Supabase SQL editor for project `rzwczgdbkmdwpyrlcueo` and run,
in order:

1. `supabase/fix-registration-trigger.sql` (contains, in this order:
   the registration trigger, the RLS recursion fix, and an optional
   backfill query for pre-existing accounts). This is a single file —
   run it top to bottom in one go.

Separately, confirm in the dashboard (not SQL): **Authentication →
Providers → Email → "Confirm email" is OFF**, per the existing note at
the top of `supabase/schema.sql` — required for the immediate
post-registration redirect to work.

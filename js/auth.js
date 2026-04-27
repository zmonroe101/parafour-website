// ─── Supabase client ──────────────────────────────────────────
// Fill in your project URL and anon key before deploying.
// Find these in: Supabase dashboard → Settings → API
const SUPABASE_URL     = 'https://rzwczgdbkmdwpyrlcueo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ6d2N6Z2Ria21kd3B5cmxjdWVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMTc2ODMsImV4cCI6MjA5Mjg5MzY4M30.wQOhSyeCx0cvhTrMVM9DFHPGgDCiXfVOjFvxAWqxInM';

// UMD global provided by the CDN script loaded before this file
const { createClient } = window.supabase;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Admin email allowlist — secondary frontend guard (role field is authoritative)
const ADMIN_EMAILS = ['zak@parafour.com'];

// ─── getCurrentUser ───────────────────────────────────────────
async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// ─── getPortalUser ────────────────────────────────────────────
async function getPortalUser() {
  const user = await getCurrentUser();
  if (!user) return null;
  const { data } = await supabase
    .from('portal_users')
    .select('*')
    .eq('auth_id', user.id)
    .single();
  return data ?? null;
}

// ─── requireAuth ─────────────────────────────────────────────
// Redirects to login if no active session. Returns auth user or null.
async function requireAuth(redirectTo = '/portal/login.html') {
  const user = await getCurrentUser();
  if (!user) {
    window.location.replace(redirectTo);
    return null;
  }
  return user;
}

// ─── requireTier ─────────────────────────────────────────────
// Ensures the user has the required role before the page renders.
// tier: 'tier1' | 'tier2' | 'admin'
async function requireTier(tier, redirectTo) {
  const user = await requireAuth();
  if (!user) return null;

  const portalUser = await getPortalUser();
  if (!portalUser) {
    window.location.replace('/portal/login.html');
    return null;
  }

  if (tier === 'admin') {
    const isAdmin = portalUser.role === 'admin' && ADMIN_EMAILS.includes(user.email);
    if (!isAdmin) {
      window.location.replace(redirectTo ?? '/portal/dashboard-t1.html');
      return null;
    }
  } else if (tier === 'tier2') {
    if (portalUser.role !== 'tier2' && portalUser.role !== 'admin') {
      window.location.replace(redirectTo ?? '/portal/dashboard-t1.html');
      return null;
    }
  }
  // tier1 just needs to be authenticated — any role passes

  return portalUser;
}

// ─── logActivity ─────────────────────────────────────────────
async function logActivity(action, metadata = {}) {
  const portalUser = await getPortalUser();
  if (!portalUser) return;
  await supabase.from('lead_activity').insert({
    portal_user_id: portalUser.id,
    action,
    metadata,
  });
}

// ─── signOut ─────────────────────────────────────────────────
async function signOut() {
  await supabase.auth.signOut();
  window.location.replace('/portal/login.html');
}

// ─── updateLastLogin ─────────────────────────────────────────
async function updateLastLogin(authId) {
  await supabase
    .from('portal_users')
    .update({ last_login: new Date().toISOString() })
    .eq('auth_id', authId);
}

// ─── populatePortalNav ───────────────────────────────────────
// Fills the topbar with user name, tier badge, and role-appropriate nav links.
async function populatePortalNav() {
  const portalUser = await getPortalUser();
  if (!portalUser) return;

  const nameEl  = document.getElementById('portalUserName');
  const badgeEl = document.getElementById('portalTierBadge');
  const navEl   = document.getElementById('portalNav');

  if (nameEl) nameEl.textContent = portalUser.full_name.split(' ')[0];

  if (badgeEl) {
    if (portalUser.role === 'admin') {
      badgeEl.textContent = 'Admin';
      badgeEl.className   = 'tier-badge tier-badge-admin';
    } else if (portalUser.role === 'tier2') {
      badgeEl.textContent = 'Certified';
      badgeEl.className   = 'tier-badge tier-badge-t2';
    } else {
      badgeEl.textContent = 'Tier 1';
      badgeEl.className   = 'tier-badge tier-badge-t1';
    }
  }

  if (navEl) {
    if (portalUser.role === 'admin') {
      navEl.innerHTML = `
        <a href="/portal/admin/" class="portal-nav-link">Dashboard</a>
        <a href="/portal/admin/users.html" class="portal-nav-link">Users</a>
        <a href="/portal/dashboard-t2.html" class="portal-nav-link">View T2 Portal</a>
      `;
    } else if (portalUser.role === 'tier2') {
      navEl.innerHTML = `
        <a href="/portal/dashboard-t2.html" class="portal-nav-link">Dashboard</a>
        <a href="/support/p4-series/" class="portal-nav-link">P4 Support</a>
        <a href="/contact/" class="portal-nav-link">Contact</a>
      `;
    } else {
      navEl.innerHTML = `
        <a href="/portal/dashboard-t1.html" class="portal-nav-link">Dashboard</a>
        <a href="/portal/apply.html" class="portal-nav-link">Apply for Tier 2</a>
        <a href="/contact/" class="portal-nav-link">Contact</a>
      `;
    }
    const path = window.location.pathname;
    navEl.querySelectorAll('.portal-nav-link').forEach(a => {
      if (a.getAttribute('href') === path) a.classList.add('active');
    });
  }
}

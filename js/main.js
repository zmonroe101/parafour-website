// Mobile navigation toggle
const navToggle = document.getElementById('navToggle');
const navLinks  = document.getElementById('navLinks');

if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('open');
    navToggle.classList.toggle('open', isOpen);
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });

  document.addEventListener('click', (e) => {
    if (!navToggle.contains(e.target) && !navLinks.contains(e.target)) {
      navLinks.classList.remove('open');
      navToggle.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    }
  });

  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('open');
      navToggle.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });
}

// ─── Affiliate referral capture (public site) ─────────────────
// Same behavior as the snippet in js/auth.js, but the public pages
// don't load the Supabase client, so the click-tracking RPC is called
// with a plain fetch. URL + anon key duplicated intentionally from
// auth.js (both are public by design; RLS + SECURITY DEFINER RPC are
// the actual protection).
(function captureAffiliateRef() {
  const PF_SUPABASE_URL = 'https://rzwczgdbkmdwpyrlcueo.supabase.co';
  const PF_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ6d2N6Z2Ria21kd3B5cmxjdWVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMTc2ODMsImV4cCI6MjA5Mjg5MzY4M30.wQOhSyeCx0cvhTrMVM9DFHPGgDCiXfVOjFvxAWqxInM';
  try {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (!ref || !/^[A-Za-z0-9-]{3,60}$/.test(ref)) return;
    sessionStorage.setItem('parafour_affiliate_ref', ref);
    document.cookie = `parafour_ref=${encodeURIComponent(ref)};path=/;max-age=${30 * 86400};SameSite=Lax`;
    if (!sessionStorage.getItem('parafour_ref_click_tracked')) {
      sessionStorage.setItem('parafour_ref_click_tracked', '1');
      fetch(`${PF_SUPABASE_URL}/rest/v1/rpc/track_affiliate_click`, {
        method: 'POST',
        headers: {
          apikey: PF_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${PF_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref_code: ref }),
        keepalive: true,
      }).catch(() => {});
    }
  } catch { /* non-fatal */ }
})();

// Active nav link highlighting
const currentPath = window.location.pathname;
document.querySelectorAll('.nav-links a').forEach(link => {
  const href = link.getAttribute('href');
  if (!href) return;
  if (href === '/' && currentPath === '/') {
    link.classList.add('active');
  } else if (href !== '/' && currentPath.startsWith(href)) {
    link.classList.add('active');
  }
});

// ═══════════════════════════════════════════════════════════════
//  portal.js — Customer Portal logic
//  Depends on: auth.js (must be loaded first)
// ═══════════════════════════════════════════════════════════════

// ─── Registration form ────────────────────────────────────────
function initRegisterForm() {
  const form = document.getElementById('registerForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn     = form.querySelector('[type="submit"]');
    const errorEl = document.getElementById('registerError');
    errorEl.classList.remove('visible');

    const fullName = form.full_name.value.trim();
    const company  = form.company.value.trim();
    const email    = form.email.value.trim();
    const phone    = form.phone.value.trim();
    const password = form.password.value;
    const confirm  = form.confirm_password.value;
    const tier2req = form.tier2_interest ? form.tier2_interest.checked : false;
    const terms    = form.terms.checked;

    if (password !== confirm) {
      errorEl.textContent = 'Passwords do not match.';
      errorEl.classList.add('visible');
      return;
    }
    if (password.length < 8) {
      errorEl.textContent = 'Password must be at least 8 characters.';
      errorEl.classList.add('visible');
      return;
    }
    if (!terms) {
      errorEl.textContent = 'You must agree to the terms to continue.';
      errorEl.classList.add('visible');
      return;
    }

    btn.disabled    = true;
    btn.textContent = 'Creating account…';

    const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });

    if (authError) {
      errorEl.textContent = authError.message.includes('already registered')
        ? 'An account with this email already exists. Try logging in.'
        : authError.message;
      errorEl.classList.add('visible');
      btn.disabled    = false;
      btn.textContent = 'Create Account';
      return;
    }

    const { error: dbError } = await supabase.from('portal_users').insert({
      email,
      full_name:          fullName,
      company,
      phone:              phone || null,
      role:               'tier1',
      status:             'active',
      tier2_requested:    tier2req,
      tier2_request_date: tier2req ? new Date().toISOString() : null,
      auth_id:            authData.user.id,
    });

    if (dbError) {
      errorEl.textContent = 'Profile setup failed. Please contact support@parafour.com.';
      errorEl.classList.add('visible');
      btn.disabled    = false;
      btn.textContent = 'Create Account';
      return;
    }

    // Best-effort activity log (portal_user_id linked by trigger/RLS)
    await supabase.from('lead_activity').insert({
      portal_user_id: null,
      action:         'registered',
      metadata:       { email, tier2_requested: tier2req },
    });

    window.location.replace('/portal/dashboard-t1.html');
  });
}

// ─── Login form ───────────────────────────────────────────────
function initLoginForm() {
  const form = document.getElementById('loginForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn      = form.querySelector('[type="submit"]');
    const errorEl  = document.getElementById('loginError');
    errorEl.classList.remove('visible');

    const email    = form.email.value.trim();
    const password = form.password.value;

    btn.disabled    = true;
    btn.textContent = 'Signing in…';

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      errorEl.textContent = 'Invalid email or password. Please try again.';
      errorEl.classList.add('visible');
      btn.disabled    = false;
      btn.textContent = 'Sign In';
      return;
    }

    await updateLastLogin(data.user.id);

    const { data: portalUser } = await supabase
      .from('portal_users')
      .select('role')
      .eq('auth_id', data.user.id)
      .single();

    if (!portalUser) {
      window.location.replace('/portal/dashboard-t1.html');
      return;
    }

    if (portalUser.role === 'admin' && ADMIN_EMAILS.includes(email)) {
      window.location.replace('/portal/admin/');
    } else if (portalUser.role === 'tier2') {
      window.location.replace('/portal/dashboard-t2.html');
    } else {
      window.location.replace('/portal/dashboard-t1.html');
    }
  });

  // Forgot password
  const forgotBtn = document.getElementById('forgotPassword');
  if (forgotBtn) {
    forgotBtn.addEventListener('click', async () => {
      const email    = form.email.value.trim();
      const errorEl  = document.getElementById('loginError');
      const successEl = document.getElementById('loginSuccess');
      if (!email) {
        errorEl.textContent = 'Enter your email address first, then click Forgot password.';
        errorEl.classList.add('visible');
        return;
      }
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/portal/login.html',
      });
      errorEl.classList.remove('visible');
      if (successEl) {
        successEl.textContent = 'Password reset email sent — check your inbox.';
        successEl.classList.add('visible');
      }
    });
  }
}

// ─── Quote request form (T1 and T2) ──────────────────────────
function initQuoteForm() {
  const form = document.getElementById('quoteForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn     = form.querySelector('[type="submit"]');
    const alertEl = document.getElementById('quoteAlert');
    btn.disabled    = true;
    btn.textContent = 'Submitting…';
    alertEl.classList.remove('visible');

    const user       = await getCurrentUser();
    const portalUser = await getPortalUser();

    const { error } = await supabase.from('quote_requests').insert({
      portal_user_id:   portalUser?.id ?? null,
      name:             portalUser?.full_name ?? '',
      company:          portalUser?.company ?? '',
      email:            user?.email ?? '',
      phone:            portalUser?.phone ?? null,
      product_interest: form.product_interest?.value?.trim() ?? '',
      quantity:         form.quantity?.value?.trim() ?? null,
      distributor:      form.distributor?.value?.trim() ?? null,
      message:          form.message?.value?.trim() ?? '',
      status:           'new',
    });

    if (error) {
      alertEl.textContent = 'Submission failed. Please email sales@parafour.com directly.';
      alertEl.className   = 'portal-alert portal-alert-error visible';
    } else {
      alertEl.textContent = 'Quote request submitted — our team will be in touch within 1 business day.';
      alertEl.className   = 'portal-alert portal-alert-success visible';
      await logActivity('quote_requested', { product_interest: form.product_interest?.value });
      form.reset();
    }
    btn.disabled    = false;
    btn.textContent = 'Submit Request';
  });
}

// ─── Tier 2 application form ──────────────────────────────────
function initApplyForm() {
  const form = document.getElementById('applyForm');
  if (!form) return;

  // Toggle distributor name field
  const distRadios = form.querySelectorAll('input[name="works_with_dist"]');
  distRadios.forEach(r => r.addEventListener('change', () => {
    const wrap = document.getElementById('distributorWrap');
    if (wrap) wrap.style.display = r.value === 'yes' ? 'block' : 'none';
  }));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn     = form.querySelector('[type="submit"]');
    const errorEl = document.getElementById('applyError');
    btn.disabled    = true;
    btn.textContent = 'Submitting…';
    errorEl.classList.remove('visible');

    const portalUser = await getPortalUser();
    if (!portalUser) { window.location.replace('/portal/login.html'); return; }

    const installTypes = [...form.querySelectorAll('input[name="install_type"]:checked')].map(c => c.value);

    const appData = {
      years_experience:      form.years_experience.value,
      install_types:         installTypes,
      dispensers_12mo:       form.dispensers_12mo.value,
      works_with_dist:       form.works_with_dist.value,
      distributor_name:      form.distributor_name?.value?.trim() ?? '',
      why_applying:          form.why_applying.value.trim(),
      subscription_interest: form.subscription_interest.value,
    };

    const { error } = await supabase
      .from('portal_users')
      .update({
        tier2_requested:    true,
        tier2_request_date: new Date().toISOString(),
        application_notes:  JSON.stringify(appData),
      })
      .eq('id', portalUser.id);

    if (error) {
      errorEl.textContent = 'Submission failed. Please try again.';
      errorEl.classList.add('visible');
      btn.disabled    = false;
      btn.textContent = 'Submit Application';
      return;
    }

    await logActivity('tier2_applied', appData);
    form.style.display = 'none';
    const conf = document.getElementById('applyConfirmation');
    if (conf) conf.classList.add('visible');
  });
}

// ═══════════════════════════════════════════════════════════════
//  Admin functions
// ═══════════════════════════════════════════════════════════════

async function loadAdminStats() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const [
    { count: total },
    { count: t1 },
    { count: t2 },
    { count: pending },
    { count: quotes },
  ] = await Promise.all([
    supabase.from('portal_users').select('*', { count: 'exact', head: true }),
    supabase.from('portal_users').select('*', { count: 'exact', head: true }).eq('role', 'tier1'),
    supabase.from('portal_users').select('*', { count: 'exact', head: true }).eq('role', 'tier2'),
    supabase.from('portal_users').select('*', { count: 'exact', head: true }).eq('tier2_requested', true).eq('role', 'tier1'),
    supabase.from('quote_requests').select('*', { count: 'exact', head: true }).eq('status', 'new').gte('created_at', sevenDaysAgo),
  ]);
  setText('statTotal',   total   ?? 0);
  setText('statTier1',   t1      ?? 0);
  setText('statTier2',   t2      ?? 0);
  setText('statPending', pending ?? 0);
  setText('statQuotes',  quotes  ?? 0);
}

async function loadPendingApps() {
  const { data } = await supabase
    .from('portal_users')
    .select('*')
    .eq('tier2_requested', true)
    .eq('role', 'tier1')
    .order('tier2_request_date', { ascending: false });

  const tbody = document.getElementById('pendingAppsTbody');
  if (!tbody) return;

  if (!data?.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="portal-empty-state">No pending applications.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(u => `
    <tr>
      <td>${esc(u.full_name)}</td>
      <td>${esc(u.company)}</td>
      <td>${esc(u.email)}</td>
      <td>${u.phone ? esc(u.phone) : '—'}</td>
      <td>${u.tier2_request_date ? fmtDate(u.tier2_request_date) : '—'}</td>
      <td>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="action-btn action-btn-approve" onclick="adminApprove('${u.id}')">Approve</button>
          <button class="action-btn action-btn-reject"  onclick="adminReject('${u.id}')">Reject</button>
          <button class="action-btn action-btn-view"    onclick="adminViewApp('${u.id}','${esc(u.full_name)}',${JSON.stringify(u.application_notes ?? '')})">View</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function loadRecentRegistrations() {
  const { data } = await supabase
    .from('portal_users')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  const tbody = document.getElementById('recentRegsTbody');
  if (!tbody || !data) return;

  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="portal-empty-state">No registrations yet.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(u => `
    <tr>
      <td>${esc(u.full_name)}</td>
      <td>${esc(u.company)}</td>
      <td>${esc(u.email)}</td>
      <td>${roleBadge(u.role)}</td>
      <td>${statusBadge(u.status)}</td>
      <td style="white-space:nowrap;">${fmtDate(u.created_at)}</td>
    </tr>
  `).join('');
}

async function loadRecentQuotes() {
  const { data } = await supabase
    .from('quote_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  const tbody = document.getElementById('recentQuotesTbody');
  if (!tbody || !data) return;

  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="portal-empty-state">No quote requests yet.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(q => `
    <tr>
      <td>${esc(q.name)}</td>
      <td>${esc(q.company)}</td>
      <td>${esc(q.email)}</td>
      <td>${esc(q.product_interest || '—')}</td>
      <td>
        <select class="status-select" onchange="adminUpdateQuote('${q.id}', this.value)">
          ${['new','contacted','quoted','closed'].map(s =>
            `<option value="${s}"${q.status===s?' selected':''}>${cap(s)}</option>`
          ).join('')}
        </select>
      </td>
      <td style="white-space:nowrap;">${fmtDate(q.created_at)}</td>
    </tr>
  `).join('');
}

async function adminApprove(id) {
  if (!confirm('Approve this user for Tier 2 access?')) return;
  const { error } = await supabase.from('portal_users').update({ role: 'tier2' }).eq('id', id);
  if (!error) { loadPendingApps(); loadRecentRegistrations(); loadAdminStats(); }
  else alert('Update failed — try again.');
}

async function adminReject(id) {
  if (!confirm('Reject this application? The user remains as Tier 1.')) return;
  const { error } = await supabase.from('portal_users').update({ tier2_requested: false, application_notes: null }).eq('id', id);
  if (!error) { loadPendingApps(); loadAdminStats(); }
  else alert('Update failed — try again.');
}

function adminViewApp(id, name, notesJson) {
  let notes;
  try { notes = typeof notesJson === 'string' ? JSON.parse(notesJson) : notesJson; } catch { notes = null; }

  if (!notes) { alert(`${name}\n\nNo application data on file.`); return; }

  const text = [
    `Applicant: ${name}`,
    '',
    `Experience: ${notes.years_experience} year(s)`,
    `Install types: ${(notes.install_types||[]).join(', ')||'—'}`,
    `Dispensers (last 12 mo): ${notes.dispensers_12mo}`,
    `Works with distributor: ${notes.works_with_dist}`,
    notes.distributor_name ? `Distributor: ${notes.distributor_name}` : '',
    `Subscription interest: ${notes.subscription_interest}`,
    '',
    'Why applying:',
    notes.why_applying,
  ].filter(Boolean).join('\n');

  alert(text);
}

async function adminUpdateQuote(id, status) {
  await supabase.from('quote_requests').update({ status }).eq('id', id);
}

// ─── Admin: user management (users.html) ─────────────────────

async function loadAllUsers() {
  const roleFilter   = document.getElementById('filterRole')?.value   ?? '';
  const statusFilter = document.getElementById('filterStatus')?.value ?? '';
  const search       = document.getElementById('searchUsers')?.value?.trim().toLowerCase() ?? '';

  let q = supabase.from('portal_users').select('*').order('created_at', { ascending: false });
  if (roleFilter)   q = q.eq('role',   roleFilter);
  if (statusFilter) q = q.eq('status', statusFilter);

  const { data } = await q;
  const tbody = document.getElementById('allUsersTbody');
  if (!tbody || !data) return;

  const rows = search
    ? data.filter(u => u.full_name.toLowerCase().includes(search) || u.email.toLowerCase().includes(search) || u.company.toLowerCase().includes(search))
    : data;

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="portal-empty-state">No users found.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(u => `
    <tr>
      <td>${esc(u.full_name)}</td>
      <td>${esc(u.company)}</td>
      <td>${esc(u.email)}</td>
      <td>
        <select class="status-select" onchange="adminSetRole('${u.id}',this.value)">
          ${['tier1','tier2','admin'].map(r=>`<option value="${r}"${u.role===r?' selected':''}>${r}</option>`).join('')}
        </select>
      </td>
      <td>
        <select class="status-select" onchange="adminSetStatus('${u.id}',this.value)">
          <option value="active"${u.status==='active'?' selected':''}>Active</option>
          <option value="suspended"${u.status==='suspended'?' selected':''}>Suspended</option>
        </select>
      </td>
      <td style="white-space:nowrap;">${fmtDate(u.created_at)}</td>
      <td style="white-space:nowrap;">${u.last_login ? fmtDate(u.last_login) : '—'}</td>
      <td>
        <button class="action-btn action-btn-view" onclick="adminViewActivity('${u.id}','${esc(u.full_name)}')">Activity</button>
      </td>
    </tr>
  `).join('');
}

async function adminSetRole(id, role) {
  await supabase.from('portal_users').update({ role }).eq('id', id);
}

async function adminSetStatus(id, status) {
  await supabase.from('portal_users').update({ status }).eq('id', id);
}

async function adminViewActivity(id, name) {
  const { data } = await supabase
    .from('lead_activity')
    .select('*')
    .eq('portal_user_id', id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (!data?.length) { alert(`Activity log: ${name}\n\nNo activity recorded.`); return; }

  const lines = data.map(a =>
    `${fmtDate(a.created_at)} — ${a.action}${a.metadata ? '\n  ' + JSON.stringify(a.metadata) : ''}`
  );
  alert(`Activity log: ${name}\n\n${lines.join('\n\n')}`);
}

// ─── CSV Export ───────────────────────────────────────────────

async function exportUsersCSV() {
  const { data } = await supabase.from('portal_users').select('*').order('created_at', { ascending: false });
  if (!data) return;
  const cols = ['full_name','company','email','phone','role','status','tier2_requested','created_at','last_login'];
  const csv  = [cols.join(','), ...data.map(u => cols.map(c => JSON.stringify(u[c]??'')).join(','))].join('\n');
  dlCSV(csv, 'parafour-portal-users.csv');
}

async function exportQuotesCSV() {
  const { data } = await supabase.from('quote_requests').select('*').order('created_at', { ascending: false });
  if (!data) return;
  const cols = ['name','company','email','phone','product_interest','quantity','distributor','message','status','created_at'];
  const csv  = [cols.join(','), ...data.map(q => cols.map(c => JSON.stringify(q[c]??'')).join(','))].join('\n');
  dlCSV(csv, 'parafour-quote-requests.csv');
}

function dlCSV(content, filename) {
  const a = Object.assign(document.createElement('a'), {
    href:     URL.createObjectURL(new Blob([content], { type: 'text/csv' })),
    download: filename,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── Shared helpers ───────────────────────────────────────────

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

function cap(str) {
  return str ? str[0].toUpperCase() + str.slice(1) : '';
}

function roleBadge(role) {
  const map = {
    tier1: '<span class="tier-badge tier-badge-t1">Tier 1</span>',
    tier2: '<span class="tier-badge tier-badge-t2">Certified</span>',
    admin: '<span class="tier-badge tier-badge-admin">Admin</span>',
  };
  return map[role] ?? role;
}

function statusBadge(status) {
  return status === 'active'
    ? '<span style="color:#059669;font-size:.8rem;font-weight:600;">Active</span>'
    : '<span style="color:#DC2626;font-size:.8rem;font-weight:600;">Suspended</span>';
}

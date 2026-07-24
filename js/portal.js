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

    const { error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: 'https://parafour-website.pages.dev/portal/',
        data: {
          full_name:       fullName,
          company,
          phone:           phone || null,
          tier2_requested: tier2req,
        },
      },
    });

    if (authError) {
      errorEl.textContent = authError.message.includes('already registered')
        ? 'An account with this email already exists. Try logging in.'
        : authError.message;
      errorEl.classList.add('visible');
      btn.disabled    = false;
      btn.textContent = 'Create Account';
      return;
    }

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
      .maybeSingle();

    if (portalUser?.role === 'tier2' || portalUser?.role === 'admin') {
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

// ─── Set-new-password form (recovery link landing on login.html) ──
function initResetPasswordForm() {
  const form = document.getElementById('resetPasswordForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn     = form.querySelector('[type="submit"]');
    const errorEl = document.getElementById('resetError');
    errorEl.classList.remove('visible');

    const password = form.password.value;
    const confirm  = form.confirm_password.value;

    if (password.length < 8) {
      errorEl.textContent = 'Password must be at least 8 characters.';
      errorEl.classList.add('visible');
      return;
    }
    if (password !== confirm) {
      errorEl.textContent = 'Passwords do not match.';
      errorEl.classList.add('visible');
      return;
    }

    btn.disabled    = true;
    btn.textContent = 'Updating…';

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      errorEl.textContent = error.message || 'Could not update password. Please request a new reset link.';
      errorEl.classList.add('visible');
      btn.disabled    = false;
      btn.textContent = 'Update Password';
      return;
    }

    // Force a fresh sign-in with the new password rather than continuing
    // to ride the temporary recovery session.
    await supabase.auth.signOut();
    window.location.replace('/portal/login.html?reset=success');
  });
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

    const { data: insertedQuote, error } = await supabase.from('quote_requests').insert({
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
    }).select('id').maybeSingle();

    if (error) {
      alertEl.textContent = 'Submission failed. Please email sales@parafour.com directly.';
      alertEl.className   = 'portal-alert portal-alert-error visible';
    } else {
      alertEl.textContent = 'Quote request submitted — our team will be in touch within 1 business day.';
      alertEl.className   = 'portal-alert portal-alert-success visible';
      await logActivity('quote_requested', { product_interest: form.product_interest?.value });
      // Affiliate attribution: if this visitor arrived via ?ref=CODE,
      // record a pending conversion (amount 0 — the admin enters the
      // real order amount on the Metrics page when the sale closes).
      await recordAffiliateConversionIfAny(insertedQuote?.id, portalUser?.id);
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
    const wrap = document.getElementById('distNameGroup');
    if (wrap) wrap.style.display = r.value === 'yes' ? 'block' : 'none';
  }));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn     = form.querySelector('[type="submit"]');
    const alertEl = document.getElementById('applyAlert');
    btn.disabled    = true;
    btn.textContent = 'Submitting…';
    alertEl.classList.remove('visible');

    const portalUser = await getPortalUser();
    if (!portalUser) { window.location.replace('/portal/login.html'); return; }

    const distChecked = form.querySelector('input[name="works_with_dist"]:checked');

    const appData = {
      business_name:     form.business_name.value.trim(),
      years_experience:  form.years_experience.value,
      role_title:        form.role_title.value.trim(),
      works_with_dist:   distChecked ? distChecked.value : '',
      distributor_name:  form.distributor_name?.value?.trim() ?? '',
      experience:        form.experience.value.trim(),
      why_applying:      form.why_applying.value.trim(),
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
      alertEl.textContent = 'Submission failed. Please try again.';
      alertEl.className   = 'portal-alert portal-alert-error visible';
      btn.disabled    = false;
      btn.textContent = 'Submit Application';
      return;
    }

    await logActivity('tier2_applied', appData);
    document.getElementById('applyFormWrap').style.display = 'none';
    const conf = document.getElementById('applyConfirmation');
    if (conf) conf.classList.add('visible');
  });
}

// ─── Affiliate conversion hook (quote flow) ──────────────────────
async function recordAffiliateConversionIfAny(quoteId, customerId) {
  try {
    const ref = typeof getAffiliateRef === 'function' ? getAffiliateRef() : null;
    if (!ref || !quoteId) return;
    await supabase.rpc('record_affiliate_conversion', {
      ref_code:      ref,
      p_quote_id:    quoteId,
      p_customer_id: customerId ?? null,
    });
  } catch { /* attribution is best-effort — never block the quote */ }
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
    notes.business_name ? `Business: ${notes.business_name}` : '',
    notes.role_title ? `Role / Title: ${notes.role_title}` : '',
    '',
    `Years in industry: ${notes.years_experience || '—'}`,
    `Works with distributor: ${notes.works_with_dist || '—'}`,
    notes.distributor_name ? `Distributor: ${notes.distributor_name}` : '',
    '',
    'Relevant experience:',
    notes.experience || '—',
    '',
    'Why applying:',
    notes.why_applying || '—',
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
      <td>${esc(u.full_name)}${u.tier2_requested && u.role === 'tier1' ? '<br><span style="color:#B45309;font-size:.72rem;font-weight:600;">Tier 2 pending</span>' : ''}</td>
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
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${u.tier2_requested && u.role === 'tier1' ? `
            <button class="action-btn action-btn-approve" onclick="adminApprove('${u.id}').then(loadAllUsers)">Approve</button>
            <button class="action-btn action-btn-reject"  onclick="adminReject('${u.id}').then(loadAllUsers)">Reject</button>
          ` : ''}
          <button class="action-btn action-btn-view" onclick="adminViewActivity('${u.id}','${esc(u.full_name)}')">Activity</button>
        </div>
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

// ─── Admin: subscription/affiliate/training metrics (metrics.html) ──

async function loadSubscriptionMetrics() {
  const { data, error } = await supabase
    .from('portal_users')
    .select('subscription_tier, subscription_status');

  const banner = document.getElementById('metricsAlert');
  if (error) {
    if (banner) {
      banner.textContent = 'Could not load subscription metrics — has supabase/subscription-model-schema.sql been run against the live database?';
      banner.className = 'portal-alert portal-alert-error visible';
    }
    return;
  }

  const counts = { free: 0, pro: 0, partner: 0 };
  (data ?? []).forEach(u => {
    const tier = u.subscription_tier || 'free';
    if (counts[tier] === undefined) return;
    counts[tier]++;
  });
  const total   = data?.length ?? 0;
  const paying  = counts.pro + counts.partner;
  const mrr     = counts.pro * 29 + counts.partner * 99;

  setText('mSubMrr',        `$${mrr.toLocaleString()}`);
  setText('mSubTotal',      total);
  setText('mSubFree',       counts.free);
  setText('mSubPro',        counts.pro);
  setText('mSubPartner',    counts.partner);
  setText('mSubConversion', total ? `${((paying / total) * 100).toFixed(1)}%` : '—');
  // Churn needs subscription history over time (Stripe dashboard has
  // it out of the box) — placeholder until a snapshot table exists.
  setText('mSubChurn', '—');
}

async function loadTrainingMetrics() {
  const [{ count: totalUsers }, { data: prog, error }] = await Promise.all([
    supabase.from('portal_users').select('*', { count: 'exact', head: true }),
    supabase.from('training_progress').select('user_id, module_id, status').eq('status', 'completed'),
  ]);

  const wrap = document.getElementById('trainingMetricsBody');
  if (!wrap) return;
  if (error) {
    wrap.innerHTML = '<tr><td colspan="3" class="portal-empty-state">Training tables not found — run subscription-model-schema.sql.</td></tr>';
    return;
  }

  const uuids = (typeof TRAINING_MODULE_UUIDS !== 'undefined') ? TRAINING_MODULE_UUIDS : {};
  const titles = (typeof TRAINING_CONTENT !== 'undefined') ? TRAINING_CONTENT : {};
  const byUser = {};
  (prog ?? []).forEach(r => {
    byUser[r.user_id] = (byUser[r.user_id] ?? 0) + 1;
  });
  const certificates = Object.values(byUser).filter(n => n >= 5).length;

  wrap.innerHTML = [1, 2, 3, 4, 5].map(n => {
    const done = (prog ?? []).filter(r => r.module_id === uuids[n]).length;
    const pct = totalUsers ? Math.round((done / totalUsers) * 100) : 0;
    return `
      <tr>
        <td>Module ${n} — ${esc(titles[n]?.title ?? '')}</td>
        <td>${done}</td>
        <td>${pct}%</td>
      </tr>`;
  }).join('') + `
    <tr style="font-weight:700;">
      <td>Certificates issued (all 5 complete)</td>
      <td>${certificates}</td>
      <td>${totalUsers ? Math.round((certificates / totalUsers) * 100) : 0}%</td>
    </tr>`;
}

async function loadAffiliateAdmin() {
  const [{ data: links, error: linksError }, { data: conversions }, { data: users }] = await Promise.all([
    supabase.from('affiliate_links').select('*'),
    supabase.from('affiliate_conversions').select('*').order('created_at', { ascending: false }),
    supabase.from('portal_users').select('id, full_name, email'),
  ]);

  const tbody = document.getElementById('affiliateConvTbody');
  if (linksError) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="portal-empty-state">Affiliate tables not found — run subscription-model-schema.sql.</td></tr>';
    return;
  }

  const linkById = {};
  (links ?? []).forEach(l => { linkById[l.id] = l; });
  const userById = {};
  (users ?? []).forEach(u => { userById[u.id] = u; });

  const convs = conversions ?? [];
  const active = convs.filter(c => c.status !== 'cancelled');
  const totalCommission   = active.reduce((s, c) => s + Number(c.commission_amount || 0), 0);
  const pendingCommission = convs.filter(c => c.status === 'pending').reduce((s, c) => s + Number(c.commission_amount || 0), 0);
  const totalClicks = (links ?? []).reduce((s, l) => s + (l.clicks || 0), 0);

  setText('mAffTotal',      `$${totalCommission.toFixed(2)}`);
  setText('mAffPending',    `$${pendingCommission.toFixed(2)}`);
  setText('mAffAffiliates', (links ?? []).length);
  setText('mAffClicks',     totalClicks);
  setText('mAffConvRate',   totalClicks ? `${((active.length / totalClicks) * 100).toFixed(1)}%` : '—');

  if (!tbody) return;
  if (!convs.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="portal-empty-state">No conversions recorded yet.</td></tr>';
    return;
  }

  tbody.innerHTML = convs.map(c => {
    const link = linkById[c.affiliate_link_id];
    const owner = link ? userById[link.user_id] : null;
    const rate = Number(c.commission_rate ?? 0.05);
    return `
      <tr>
        <td style="white-space:nowrap;">${fmtDate(c.created_at)}</td>
        <td>${esc(link?.code ?? '—')}<br><span style="font-size:.72rem;color:#6B7280;">${esc(owner?.full_name ?? '')}</span></td>
        <td>
          <input type="number" min="0" step="0.01" class="conv-amount-input" id="convAmount-${c.id}"
                 value="${Number(c.order_amount || 0)}" ${c.status === 'paid' ? 'disabled' : ''} />
        </td>
        <td style="white-space:nowrap;">${(rate * 100).toFixed(0)}%</td>
        <td style="white-space:nowrap;">$${Number(c.commission_amount || 0).toFixed(2)}</td>
        <td>${convStatusBadge(c.status)}</td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${c.status === 'pending' ? `
              <button class="action-btn action-btn-edit"    onclick="adminSetConversionAmount('${c.id}', ${rate})">Save Amount</button>
              <button class="action-btn action-btn-approve" onclick="adminMarkConversionPaid('${c.id}')">Mark Paid</button>
              <button class="action-btn action-btn-reject"  onclick="adminCancelConversion('${c.id}')">Cancel</button>
            ` : (c.paid_at ? `<span style="font-size:.75rem;color:#6B7280;">Paid ${fmtDate(c.paid_at)}</span>` : '')}
          </div>
        </td>
      </tr>`;
  }).join('');
}

function convStatusBadge(status) {
  const map = {
    pending:   '<span class="training-pill training-pill-progress">Pending</span>',
    paid:      '<span class="training-pill training-pill-done">Paid</span>',
    cancelled: '<span class="training-pill training-pill-new">Cancelled</span>',
  };
  return map[status] ?? esc(status ?? '');
}

// Record the real order amount for a conversion once the sale closes —
// this is where actual commission attribution happens (quotes carry no
// dollar amount at submission time).
async function adminSetConversionAmount(id, rate) {
  const input = document.getElementById(`convAmount-${id}`);
  const amount = parseFloat(input?.value);
  if (!Number.isFinite(amount) || amount < 0) { alert('Enter a valid order amount first.'); return; }
  const commission = Math.round(amount * rate * 100) / 100;
  const { error } = await supabase
    .from('affiliate_conversions')
    .update({ order_amount: amount, commission_amount: commission })
    .eq('id', id);
  if (error) alert('Update failed — try again.');
  else loadAffiliateAdmin();
}

async function adminMarkConversionPaid(id) {
  if (!confirm('Mark this commission as paid?')) return;
  const { error } = await supabase
    .from('affiliate_conversions')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', id);
  if (error) alert('Update failed — try again.');
  else loadAffiliateAdmin();
}

async function adminCancelConversion(id) {
  if (!confirm('Cancel this conversion? Its commission will not count toward payouts.')) return;
  const { error } = await supabase
    .from('affiliate_conversions')
    .update({ status: 'cancelled' })
    .eq('id', id);
  if (error) alert('Update failed — try again.');
  else loadAffiliateAdmin();
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

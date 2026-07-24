// ═══════════════════════════════════════════════════════════════
//  affiliate.js — Partner-tier affiliate dashboard logic
//  Depends on: auth.js, portal.js (esc/fmtDate/setText/dlCSV),
//              access.js (hasAccess/showUpgradePrompt)
//
//  Page: /portal/affiliate.html (Partner subscription only; admins
//  bypass). Codes look like FIRSTNAME-ABC123 and live in
//  affiliate_links; conversions in affiliate_conversions (see
//  supabase/subscription-model-schema.sql).
// ═══════════════════════════════════════════════════════════════

function generateAffiliateCode(fullName) {
  const first = (fullName || 'PARTNER')
    .trim().split(/\s+/)[0]
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '') || 'PARTNER';
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
  let random = '';
  for (let i = 0; i < 6; i++) {
    random += charset[Math.floor(Math.random() * charset.length)];
  }
  return `${first}-${random}`;
}

async function initAffiliateDashboard(portalUser) {
  const { data: link, error } = await supabase
    .from('affiliate_links')
    .select('*')
    .eq('user_id', portalUser.id)
    .maybeSingle();

  if (error) {
    showAffiliateAlert('Could not load affiliate data — the affiliate tables may not be set up yet (run supabase/subscription-model-schema.sql).', 'error');
    return;
  }

  if (!link) {
    // No link yet — show the generate card.
    document.getElementById('affiliateGenerate').style.display = 'block';
    const btn = document.getElementById('generateLinkBtn');
    btn?.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Generating…';
      // Retry a few times in the (unlikely) event of a code collision.
      for (let attempt = 0; attempt < 4; attempt++) {
        const code = generateAffiliateCode(portalUser.full_name);
        const { error: insError } = await supabase.from('affiliate_links').insert({
          user_id: portalUser.id,
          code,
        });
        if (!insError) {
          await logActivity('affiliate_link_created', { code });
          window.location.reload();
          return;
        }
        if (!`${insError.message}`.toLowerCase().includes('duplicate')) {
          showAffiliateAlert('Could not create your affiliate link — please try again.', 'error');
          btn.disabled = false;
          btn.textContent = 'Generate My Affiliate Link';
          return;
        }
      }
      showAffiliateAlert('Could not create a unique code — please try again.', 'error');
      btn.disabled = false;
      btn.textContent = 'Generate My Affiliate Link';
    });
    return;
  }

  // Link exists — render dashboard.
  document.getElementById('affiliateDash').style.display = 'block';
  renderAffiliateLink(link);
  await renderAffiliateStats(link);
}

function renderAffiliateLink(link) {
  const url = `${window.location.origin}/?ref=${encodeURIComponent(link.code)}`;
  setText('affCode', link.code);
  const urlEl = document.getElementById('affUrl');
  if (urlEl) urlEl.value = url;

  document.getElementById('copyLinkBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('copyLinkBtn');
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API can be unavailable — fall back to select+copy.
      urlEl?.select();
      document.execCommand('copy');
    }
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = 'Copy Link'; }, 2000);
  });
}

async function renderAffiliateStats(link) {
  const { data: conversions, error } = await supabase
    .from('affiliate_conversions')
    .select('*')
    .eq('affiliate_link_id', link.id)
    .order('created_at', { ascending: false });

  if (error) {
    showAffiliateAlert('Could not load your conversions.', 'error');
    return;
  }

  const convs = conversions ?? [];
  const counted = convs.filter(c => c.status !== 'cancelled');
  const totalEarnings = counted.reduce((s, c) => s + Number(c.commission_amount || 0), 0);
  const pending = convs.filter(c => c.status === 'pending').reduce((s, c) => s + Number(c.commission_amount || 0), 0);
  const paid = convs.filter(c => c.status === 'paid').reduce((s, c) => s + Number(c.commission_amount || 0), 0);
  const clicks = link.clicks || 0;

  setText('affEarnings', `$${totalEarnings.toFixed(2)}`);
  setText('affPending',  `$${pending.toFixed(2)}`);
  setText('affPaid',     `$${paid.toFixed(2)}`);
  setText('affClicks',   clicks);
  setText('affConvRate', clicks ? `${((counted.length / clicks) * 100).toFixed(1)}%` : '—');

  const tbody = document.getElementById('affConvTbody');
  if (tbody) {
    if (!convs.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="portal-empty-state">No conversions yet — share your link to get started!</td></tr>';
    } else {
      tbody.innerHTML = convs.map(c => `
        <tr>
          <td style="white-space:nowrap;">${fmtDate(c.created_at)}</td>
          <td>${Number(c.order_amount) > 0
            ? `$${Number(c.order_amount).toFixed(2)}`
            : '<span style="color:#92400E;font-size:.78rem;">Awaiting final amount</span>'}</td>
          <td style="white-space:nowrap;">$${Number(c.commission_amount || 0).toFixed(2)}</td>
          <td>${convStatusBadge(c.status)}</td>
          <td style="white-space:nowrap;">${c.paid_at ? fmtDate(c.paid_at) : '—'}</td>
        </tr>
      `).join('');
    }
  }

  // CSV export
  document.getElementById('exportConvBtn')?.addEventListener('click', () => {
    const cols = ['created_at', 'order_amount', 'commission_rate', 'commission_amount', 'status', 'paid_at', 'notes'];
    const csv = [
      cols.join(','),
      ...convs.map(c => cols.map(col => JSON.stringify(c[col] ?? '')).join(',')),
    ].join('\n');
    dlCSV(csv, 'conversions.csv');
  });
}

function showAffiliateAlert(msg, kind) {
  const el = document.getElementById('affiliateAlert');
  if (!el) return;
  el.textContent = msg;
  el.className = `portal-alert portal-alert-${kind === 'error' ? 'error' : 'success'} visible`;
}

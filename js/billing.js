// ═══════════════════════════════════════════════════════════════
//  billing.js — Subscription plans + Stripe Checkout client logic
//  Depends on: auth.js (must be loaded first)
//
//  No Stripe secret (or even publishable) key lives client-side:
//  the Cloudflare Pages Functions in /functions/api/ create the
//  Checkout / Billing-Portal sessions server-side and this file
//  just redirects the browser to the returned Stripe-hosted URL.
// ═══════════════════════════════════════════════════════════════

// Subscription plans — orthogonal to the tier1/tier2/admin role
// system. Any role can hold any subscription.
const SUBSCRIPTION_PLANS = {
  free: {
    name: 'Free',
    price: 0,
    blurb: 'Get started with the essentials.',
    features: [
      'Intro training (5 modules + certificate)',
      'Product guides & spec sheets',
      'Quote requests',
    ],
  },
  pro: {
    name: 'Pro',
    price: 29,
    blurb: 'For installers and station operators.',
    features: [
      'Everything in Free',
      'Advanced training (coming soon)',
      'Priority support — 1-business-hour response',
    ],
  },
  partner: {
    name: 'Partner',
    price: 99,
    blurb: 'For distributors and referral partners.',
    features: [
      'Everything in Pro',
      'Affiliate dashboard & referral links',
      '5% commission on referred sales',
      'Bulk order discounts',
    ],
  },
};

function subscriptionTierOf(portalUser) {
  return portalUser?.subscription_tier || 'free';
}

// ─── API calls (Cloudflare Pages Functions) ──────────────────────

async function billingApi(path, body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.replace('/portal/login.html');
    return null;
  }
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Billing service unavailable. Please try again.');
  return data;
}

// Redirect to Stripe Checkout for the given paid tier ('pro'|'partner').
async function startCheckout(tier) {
  const data = await billingApi('/api/create-checkout-session', { tier });
  if (data?.url) window.location.href = data.url;
}

// Redirect to the Stripe Billing Portal (manage / change / cancel plan).
async function openBillingPortal() {
  const data = await billingApi('/api/customer-portal');
  if (data?.url) window.location.href = data.url;
}

// ─── Account page (portal/account.html) ──────────────────────────

function initAccountPage(portalUser) {
  renderCurrentPlan(portalUser);
  renderPricingGrid(portalUser);
  handleCheckoutReturn(portalUser);
}

function renderCurrentPlan(portalUser) {
  const tier = subscriptionTierOf(portalUser);
  const plan = SUBSCRIPTION_PLANS[tier] ?? SUBSCRIPTION_PLANS.free;
  const status = portalUser.subscription_status;
  const renews = portalUser.subscription_current_period_end;

  setText('currentPlanName', plan.name);
  setText('currentPlanPrice', plan.price ? `$${plan.price}/mo` : '$0/mo');

  const statusEl = document.getElementById('currentPlanStatus');
  if (statusEl) {
    if (tier === 'free' || !status) {
      statusEl.textContent = '';
    } else if (status === 'active' || status === 'trialing') {
      statusEl.textContent = renews
        ? `Active — renews ${new Date(renews).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
        : 'Active';
      statusEl.style.color = '#166534';
    } else {
      statusEl.textContent = `Status: ${status.replace(/_/g, ' ')} — please update your payment method.`;
      statusEl.style.color = '#991B1B';
    }
  }

  const manageBtn = document.getElementById('manageBillingBtn');
  if (manageBtn) {
    if (portalUser.stripe_customer_id) {
      manageBtn.style.display = '';
      manageBtn.addEventListener('click', async () => {
        manageBtn.disabled = true;
        manageBtn.textContent = 'Opening…';
        try { await openBillingPortal(); }
        catch (err) {
          showBillingAlert(err.message, 'error');
          manageBtn.disabled = false;
          manageBtn.textContent = 'Manage Subscription';
        }
      });
    } else {
      manageBtn.style.display = 'none';
    }
  }
}

function renderPricingGrid(portalUser) {
  const grid = document.getElementById('pricingGrid');
  if (!grid) return;
  const currentTier = subscriptionTierOf(portalUser);
  const order = ['free', 'pro', 'partner'];

  grid.innerHTML = order.map(tier => {
    const plan = SUBSCRIPTION_PLANS[tier];
    const isCurrent = tier === currentTier;
    return `
      <div class="pricing-card${tier === 'pro' ? ' pricing-card-featured' : ''}${isCurrent ? ' pricing-card-current' : ''}">
        ${tier === 'pro' ? '<span class="pricing-popular-pill">Most Popular</span>' : ''}
        <h3>${plan.name}</h3>
        <div class="pricing-price">$${plan.price}<span>/mo</span></div>
        <p class="pricing-blurb">${plan.blurb}</p>
        <ul class="pricing-features">
          ${plan.features.map(f => `<li>${f}</li>`).join('')}
        </ul>
        ${pricingCta(tier, currentTier, portalUser)}
      </div>
    `;
  }).join('');

  grid.querySelectorAll('[data-checkout-tier]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Redirecting…';
      try { await startCheckout(btn.dataset.checkoutTier); }
      catch (err) {
        showBillingAlert(err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Upgrade Now';
      }
    });
  });

  const portalBtn = grid.querySelector('[data-open-portal]');
  if (portalBtn) {
    portalBtn.addEventListener('click', async () => {
      portalBtn.disabled = true;
      portalBtn.textContent = 'Opening…';
      try { await openBillingPortal(); }
      catch (err) {
        showBillingAlert(err.message, 'error');
        portalBtn.disabled = false;
        portalBtn.textContent = 'Change Plan';
      }
    });
  }
}

function pricingCta(tier, currentTier, portalUser) {
  if (tier === currentTier) {
    return '<button class="btn btn-secondary pricing-cta" disabled>Current Plan</button>';
  }
  if (tier === 'free') {
    // Downgrading to Free = cancelling the paid subscription in the
    // Stripe Billing Portal.
    return portalUser.stripe_customer_id
      ? '<button class="btn btn-secondary pricing-cta" data-open-portal>Change Plan</button>'
      : '<button class="btn btn-secondary pricing-cta" disabled>Current Plan</button>';
  }
  // Existing paying subscribers switch plans through the Billing Portal
  // (handles proration); everyone else goes through Checkout.
  if (currentTier !== 'free' && portalUser.stripe_customer_id) {
    return '<button class="btn btn-primary pricing-cta" data-open-portal>Change Plan</button>';
  }
  return `<button class="btn btn-primary pricing-cta" data-checkout-tier="${tier}">Upgrade Now</button>`;
}

// After returning from Stripe Checkout the webhook may take a few
// seconds to update portal_users — show a banner and refresh once.
function handleCheckoutReturn(portalUser) {
  const params = new URLSearchParams(window.location.search);
  const result = params.get('checkout');
  if (!result) return;

  if (result === 'success') {
    showBillingAlert('Payment received! Your plan is being activated — this page will refresh in a few seconds.', 'success');
    if (!sessionStorage.getItem('parafour_checkout_refreshed')) {
      sessionStorage.setItem('parafour_checkout_refreshed', '1');
      setTimeout(() => window.location.replace('/portal/account.html?checkout=done'), 4000);
    }
  } else if (result === 'cancelled') {
    showBillingAlert('Checkout cancelled — no charge was made.', 'error');
  } else if (result === 'done') {
    sessionStorage.removeItem('parafour_checkout_refreshed');
    if (subscriptionTierOf(portalUser) !== 'free') {
      showBillingAlert(`You're all set — welcome to the ${SUBSCRIPTION_PLANS[subscriptionTierOf(portalUser)].name} plan!`, 'success');
    } else {
      showBillingAlert('Payment received. Your plan can take a minute to activate — refresh this page shortly.', 'success');
    }
  }
}

function showBillingAlert(msg, kind) {
  const el = document.getElementById('billingAlert');
  if (!el) return;
  el.textContent = msg;
  el.className = `portal-alert portal-alert-${kind === 'error' ? 'error' : 'success'} visible`;
}

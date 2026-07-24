// ═══════════════════════════════════════════════════════════════
//  access.js — Tiered access control (subscription gates)
//  Depends on: auth.js (must be loaded first)
//
//  Subscription tiers (free | pro | partner) are ORTHOGONAL to the
//  role system (tier1 | tier2 | admin). A tier1 customer or a tier2
//  contractor can each hold any subscription. Admins bypass all
//  subscription gates.
//
//  NOTE: like the rest of this static portal, these gates control the
//  UI/navigation layer. The revenue-critical data itself (affiliate
//  earnings, training progress, billing fields) is protected
//  server-side by RLS policies and the protect_subscription_columns
//  trigger in supabase/subscription-model-schema.sql.
// ═══════════════════════════════════════════════════════════════

const TIER_FEATURES = {
  free:    ['intro_training', 'product_guides'],
  pro:     ['intro_training', 'product_guides', 'advanced_training', 'priority_support'],
  partner: ['intro_training', 'product_guides', 'advanced_training', 'priority_support', 'affiliate_dashboard', 'commissions', 'bulk_discounts'],
};

// Display metadata for the upgrade prompt, keyed by feature.
const FEATURE_INFO = {
  intro_training:      { label: 'Intro Training' },
  product_guides:      { label: 'Product Guides' },
  advanced_training:   { label: 'Advanced Training' },
  priority_support:    { label: 'Priority Support' },
  affiliate_dashboard: { label: 'Affiliate Dashboard' },
  commissions:         { label: 'Referral Commissions' },
  bulk_discounts:      { label: 'Bulk Discounts' },
};

// Lowest subscription tier that includes a feature.
function requiredTierFor(feature) {
  if (TIER_FEATURES.free.includes(feature)) return 'free';
  if (TIER_FEATURES.pro.includes(feature)) return 'pro';
  if (TIER_FEATURES.partner.includes(feature)) return 'partner';
  return 'partner';
}

// ─── hasAccess ───────────────────────────────────────────────────
// The single access-check used everywhere. `user` is a portal_users
// row (from getPortalUser()/requireTier()).
function hasAccess(user, feature) {
  if (!user) return false;
  if (user.role === 'admin') return true; // admins bypass subscription gates
  const tier = user.subscription_tier || 'free';
  return TIER_FEATURES[tier]?.includes(feature) || false;
}

// ─── guardFeature ────────────────────────────────────────────────
// Convenience wrapper for click handlers on gated content:
// returns true if allowed, otherwise shows the upgrade prompt.
function guardFeature(user, feature) {
  if (hasAccess(user, feature)) return true;
  showUpgradePrompt(feature);
  return false;
}

// ─── Upgrade prompt modal ────────────────────────────────────────
function showUpgradePrompt(feature) {
  const tier = requiredTierFor(feature);
  const plan = (typeof SUBSCRIPTION_PLANS !== 'undefined' && SUBSCRIPTION_PLANS[tier]) || null;
  const planName  = plan ? plan.name : tier === 'partner' ? 'Partner' : 'Pro';
  const planPrice = plan ? plan.price : tier === 'partner' ? 99 : 29;
  const benefits  = plan ? plan.features : [];
  const featureLabel = FEATURE_INFO[feature]?.label ?? 'this feature';

  closeUpgradePrompt();

  const overlay = document.createElement('div');
  overlay.className = 'upgrade-modal-overlay';
  overlay.id = 'upgradeModalOverlay';
  overlay.innerHTML = `
    <div class="upgrade-modal" role="dialog" aria-modal="true" aria-labelledby="upgradeModalTitle">
      <button class="upgrade-modal-close" aria-label="Close" onclick="closeUpgradePrompt()">×</button>
      <div class="upgrade-modal-icon">🔓</div>
      <h3 id="upgradeModalTitle">Upgrade to ${planName} for $${planPrice}/mo</h3>
      <p class="upgrade-modal-sub">${featureLabel} is included with the ${planName} plan.</p>
      ${benefits.length ? `
        <ul class="upgrade-modal-benefits">
          ${benefits.map(b => `<li>${b}</li>`).join('')}
        </ul>` : ''}
      <div class="upgrade-modal-actions">
        <a href="/portal/account.html" class="btn btn-primary">Upgrade Now</a>
        <button class="btn btn-secondary" onclick="closeUpgradePrompt()">Maybe Later</button>
      </div>
    </div>
  `;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeUpgradePrompt();
  });
  document.body.appendChild(overlay);
}

function closeUpgradePrompt() {
  document.getElementById('upgradeModalOverlay')?.remove();
}

// ─── Subscription badge (topbar) ─────────────────────────────────
// Inserted next to the role badge on every portal page. Called from
// populatePortalNav() in auth.js.
function renderSubscriptionBadge(portalUser) {
  const roleBadge = document.getElementById('portalTierBadge');
  if (!roleBadge) return;
  let el = document.getElementById('portalSubBadge');
  if (!el) {
    el = document.createElement('span');
    el.id = 'portalSubBadge';
    roleBadge.insertAdjacentElement('afterend', el);
  }
  const tier = portalUser.subscription_tier || 'free';
  el.textContent = tier === 'partner' ? 'Partner' : tier === 'pro' ? 'Pro' : 'Free';
  el.className = `sub-badge sub-badge-${tier}`;
  el.title = 'Membership plan — manage in Account & Billing';
}

// ─── Gated benefit cards ─────────────────────────────────────────
// Marks up any element with [data-feature]: unlocked cards keep their
// link behavior; locked cards get a lock pill and open the upgrade
// prompt instead of navigating.
function applyFeatureGates(portalUser) {
  document.querySelectorAll('[data-feature]').forEach(card => {
    const feature = card.dataset.feature;
    if (hasAccess(portalUser, feature)) return;

    const tier = requiredTierFor(feature);
    const pill = document.createElement('span');
    pill.className = 'feature-lock-pill';
    pill.textContent = tier === 'partner' ? '🔒 Partner plan' : '🔒 Pro plan';
    card.appendChild(pill);
    card.classList.add('feature-locked');

    card.addEventListener('click', (e) => {
      e.preventDefault();
      showUpgradePrompt(feature);
    });
  });
}

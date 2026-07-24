// ═══════════════════════════════════════════════════════════════
//  POST /api/create-checkout-session
//  Cloudflare Pages Function — creates a Stripe Checkout session
//  for a Pro ($29/mo) or Partner ($99/mo) subscription.
//
//  Request:  { "tier": "pro" | "partner" }
//            Authorization: Bearer <supabase access token>
//  Response: { "url": "<stripe checkout url>" }  → client redirects
//
//  Required Cloudflare Pages environment variables (Settings →
//  Environment variables, Production + Preview):
//    STRIPE_SECRET_KEY          sk_test_... / sk_live_...
//    STRIPE_PRICE_PRO           price_... (Pro $29/mo recurring price)
//    STRIPE_PRICE_PARTNER      price_... (Partner $99/mo recurring price)
//    SUPABASE_URL               https://rzwczgdbkmdwpyrlcueo.supabase.co
//    SUPABASE_SERVICE_ROLE_KEY  service_role key (Supabase → Settings → API)
//
//  No npm dependencies — Stripe is called via its form-encoded REST
//  API directly, which keeps this repo a pure static site with no
//  build step. Secret keys live ONLY in Pages env bindings, never in
//  client JS.
// ═══════════════════════════════════════════════════════════════

export async function onRequestPost({ request, env }) {
  try {
    const missing = firstMissingEnv(env, [
      'STRIPE_SECRET_KEY', 'STRIPE_PRICE_PRO', 'STRIPE_PRICE_PARTNER',
      'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    ]);
    if (missing) return json({ error: `Server not configured (missing ${missing}). See stripe-setup-guide.md.` }, 500);

    // ── Authenticate the caller via their Supabase session token ──
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Not authenticated.' }, 401);

    const authUser = await getSupabaseAuthUser(env, token);
    if (!authUser?.id) return json({ error: 'Invalid or expired session. Please sign in again.' }, 401);

    // ── Validate requested tier ──
    const body = await request.json().catch(() => ({}));
    const tier = body.tier;
    const priceId = tier === 'pro' ? env.STRIPE_PRICE_PRO
                  : tier === 'partner' ? env.STRIPE_PRICE_PARTNER
                  : null;
    if (!priceId) return json({ error: 'Unknown subscription tier.' }, 400);

    // ── Load the portal_users row (service role bypasses RLS) ──
    const portalUser = await sbSelectOne(env,
      `portal_users?auth_id=eq.${encodeURIComponent(authUser.id)}&select=id,email,full_name,stripe_customer_id,subscription_tier`);
    if (!portalUser) return json({ error: 'Portal account not found.' }, 404);

    // ── Reuse or create the Stripe customer ──
    let customerId = portalUser.stripe_customer_id;
    if (!customerId) {
      const customer = await stripePost(env, 'customers', {
        email: portalUser.email,
        name: portalUser.full_name,
        'metadata[portal_user_id]': portalUser.id,
      });
      customerId = customer.id;
      await sbPatch(env, `portal_users?id=eq.${portalUser.id}`, { stripe_customer_id: customerId });
    }

    // ── Create the Checkout session ──
    const origin = new URL(request.url).origin;
    const session = await stripePost(env, 'checkout/sessions', {
      mode: 'subscription',
      customer: customerId,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      success_url: `${origin}/portal/account.html?checkout=success`,
      cancel_url: `${origin}/portal/account.html?checkout=cancelled`,
      'metadata[portal_user_id]': portalUser.id,
      'subscription_data[metadata][portal_user_id]': portalUser.id,
      allow_promotion_codes: 'true',
    });

    return json({ url: session.url });
  } catch (err) {
    return json({ error: err.message || 'Unexpected server error.' }, 500);
  }
}

// ─── helpers ─────────────────────────────────────────────────────

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function firstMissingEnv(env, names) {
  return names.find(n => !env[n]) || null;
}

async function getSupabaseAuthUser(env, accessToken) {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

async function sbSelectOne(env, pathAndQuery) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${pathAndQuery}&limit=1`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] ?? null;
}

async function sbPatch(env, pathAndQuery, patch) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Supabase update failed (${res.status})`);
}

async function stripePost(env, path, params) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Stripe error (${res.status})`);
  return data;
}

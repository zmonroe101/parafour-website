// ═══════════════════════════════════════════════════════════════
//  POST /api/customer-portal
//  Cloudflare Pages Function — creates a Stripe Billing Portal
//  session so subscribers can manage/upgrade/cancel their plan and
//  update payment methods. Stripe hosts the whole UI.
//
//  Request:  (no body)
//            Authorization: Bearer <supabase access token>
//  Response: { "url": "<stripe billing portal url>" }
//
//  Required Cloudflare Pages environment variables:
//    STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//  (See stripe-setup-guide.md; also enable the Billing Portal in the
//   Stripe dashboard: Settings → Billing → Customer portal.)
// ═══════════════════════════════════════════════════════════════

export async function onRequestPost({ request, env }) {
  try {
    const missing = ['STRIPE_SECRET_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].find(n => !env[n]);
    if (missing) return json({ error: `Server not configured (missing ${missing}).` }, 500);

    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Not authenticated.' }, 401);

    const authUser = await getSupabaseAuthUser(env, token);
    if (!authUser?.id) return json({ error: 'Invalid or expired session. Please sign in again.' }, 401);

    const portalUser = await sbSelectOne(env,
      `portal_users?auth_id=eq.${encodeURIComponent(authUser.id)}&select=id,stripe_customer_id`);
    if (!portalUser) return json({ error: 'Portal account not found.' }, 404);
    if (!portalUser.stripe_customer_id) {
      return json({ error: 'No billing profile yet — subscribe to a plan first.' }, 400);
    }

    const origin = new URL(request.url).origin;
    const session = await stripePost(env, 'billing_portal/sessions', {
      customer: portalUser.stripe_customer_id,
      return_url: `${origin}/portal/account.html`,
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

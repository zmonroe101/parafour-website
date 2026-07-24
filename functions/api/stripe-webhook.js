// ═══════════════════════════════════════════════════════════════
//  POST /api/stripe-webhook
//  Cloudflare Pages Function — Stripe webhook receiver.
//
//  Register this endpoint in the Stripe dashboard (Developers →
//  Webhooks → Add endpoint):
//    URL:    https://<your-domain>/api/stripe-webhook
//    Events: checkout.session.completed
//            customer.subscription.updated
//            customer.subscription.deleted
//            invoice.payment_failed
//
//  Required Cloudflare Pages environment variables:
//    STRIPE_SECRET_KEY          sk_test_... / sk_live_...
//    STRIPE_WEBHOOK_SECRET      whsec_... (from the webhook endpoint page)
//    STRIPE_PRICE_PRO           price_... (Pro $29/mo)
//    STRIPE_PRICE_PARTNER       price_... (Partner $99/mo)
//    SUPABASE_URL               https://rzwczgdbkmdwpyrlcueo.supabase.co
//    SUPABASE_SERVICE_ROLE_KEY  service_role key
//
//  Signature verification is done manually with Web Crypto
//  (HMAC-SHA256 over `${timestamp}.${rawBody}` — Stripe's documented
//  scheme) so no npm packages are needed in this static repo.
//  Updates to portal_users are made with the Supabase service-role
//  key, which bypasses RLS; the subscription columns are additionally
//  protected server-side by the protect_subscription_columns trigger
//  (see supabase/subscription-model-schema.sql).
// ═══════════════════════════════════════════════════════════════

export async function onRequestPost({ request, env }) {
  const missing = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
    .find(n => !env[n]);
  if (missing) return new Response(`Server not configured (missing ${missing})`, { status: 500 });

  const payload = await request.text();
  const sigHeader = request.headers.get('stripe-signature');

  const valid = await verifyStripeSignature(payload, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return new Response('Invalid signature', { status: 400 });

  let event;
  try { event = JSON.parse(payload); }
  catch { return new Response('Invalid payload', { status: 400 }); }

  try {
    switch (event.type) {

      // Fired when a customer completes Checkout for a new subscription.
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode !== 'subscription' || !session.subscription) break;
        const sub = await stripeGet(env, `subscriptions/${session.subscription}`);
        const update = subscriptionToUpdate(env, sub);
        update.stripe_customer_id = typeof session.customer === 'string' ? session.customer : session.customer?.id;
        const portalUserId = session.metadata?.portal_user_id;
        if (portalUserId) {
          await sbPatch(env, `portal_users?id=eq.${portalUserId}`, update);
        } else if (update.stripe_customer_id) {
          await sbPatch(env, `portal_users?stripe_customer_id=eq.${update.stripe_customer_id}`, update);
        }
        break;
      }

      // Fired on plan changes, renewals, cancel-at-period-end, etc.
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        await patchBySubscription(env, sub, subscriptionToUpdate(env, sub));
        break;
      }

      // Fired when a subscription is fully cancelled — revert to Free.
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await patchBySubscription(env, sub, {
          subscription_tier: 'free',
          subscription_status: 'canceled',
          stripe_subscription_id: null,
          subscription_current_period_end: null,
        });
        break;
      }

      // Keep the status honest while Stripe retries the card.
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
        if (customerId) {
          await sbPatch(env, `portal_users?stripe_customer_id=eq.${customerId}`, {
            subscription_status: 'past_due',
          });
        }
        break;
      }

      default:
        // Unhandled event types are acknowledged so Stripe stops retrying.
        break;
    }
  } catch (err) {
    // Non-2xx makes Stripe retry with backoff — desired for transient
    // Supabase failures.
    return new Response(`Webhook handler error: ${err.message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── event → portal_users mapping ────────────────────────────────

function subscriptionToUpdate(env, sub) {
  const priceId = sub.items?.data?.[0]?.price?.id;
  let tier = priceId === env.STRIPE_PRICE_PARTNER ? 'partner'
           : priceId === env.STRIPE_PRICE_PRO ? 'pro'
           : 'free';
  // A subscription that is no longer collectible confers no paid access.
  if (['canceled', 'unpaid', 'incomplete_expired'].includes(sub.status)) tier = 'free';
  return {
    subscription_tier: tier,
    stripe_subscription_id: sub.id,
    subscription_status: sub.status,
    subscription_current_period_end: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null,
  };
}

async function patchBySubscription(env, sub, update) {
  const portalUserId = sub.metadata?.portal_user_id;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  if (portalUserId) {
    await sbPatch(env, `portal_users?id=eq.${portalUserId}`, update);
  } else if (customerId) {
    await sbPatch(env, `portal_users?stripe_customer_id=eq.${customerId}`, update);
  }
}

// ─── Stripe signature verification (Web Crypto, no SDK) ──────────

async function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader || !secret) return false;

  let timestamp = null;
  const signatures = [];
  for (const part of sigHeader.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === 't') timestamp = value;
    else if (key === 'v1') signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return false;

  // Reject replayed events older than 5 minutes.
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`));
  const expected = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');

  return signatures.some(sig => timingSafeEqual(sig, expected));
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ─── Stripe + Supabase REST helpers ──────────────────────────────

async function stripeGet(env, path) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Stripe error (${res.status})`);
  return data;
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

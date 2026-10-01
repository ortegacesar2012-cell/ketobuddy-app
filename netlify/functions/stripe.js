const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// KetoBuddy's auth is the custom email/password + JWT system served by the
// /auth function. That function signs tokens with JWT_SECRET and puts the
// user's email + userId in the payload. Two payload shapes have shipped:
//   { email, userId, plan, ... }   and   { sub, email, ... }
// Verify the signature first, then trust the claims.

function verifyKbToken(authHeader) {
  const m = /^Bearer\s+(.+)$/i.exec(authHeader || '');
  if (!m) throw new Error('Not signed in');
  const parts = m[1].split('.');
  if (parts.length !== 3) throw new Error('Invalid session token');

  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('Server is not configured for sign-in (JWT_SECRET missing)');

  const [h, p, s] = parts;
  const expected = require('crypto')
    .createHmac('sha256', secret)
    .update(`${h}.${p}`)
    .digest('base64url');
  const got = Buffer.from(s), want = Buffer.from(expected);
  if (got.length !== want.length || !require('crypto').timingSafeEqual(got, want)) {
    throw new Error('Session expired — please sign in again');
  }

  let payload;
  try { payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')); }
  catch { throw new Error('Invalid session token'); }
  if (payload.exp && Date.now() / 1000 >= payload.exp) {
    throw new Error('Session expired — please sign in again');
  }

  const email = payload.email || payload.user?.email;
  const userId = payload.userId ?? payload.id ?? payload.sub ?? payload.user?.id;
  if (!email && !userId) throw new Error('Session token has no user identity');
  return { email: email || null, userId: userId != null ? String(userId) : null };
}

async function findCustomerFor(user) {
  // Prefer the customer this account created at checkout (tagged with its userId)
  if (user.userId) {
    const all = await stripe.customers.list({ limit: 100 });
    const tagged = all.data.find(c => c.metadata && c.metadata.userId === user.userId);
    if (tagged) return tagged;
  }
  if (user.email) {
    const byEmail = await stripe.customers.list({ email: user.email, limit: 1 });
    if (byEmail.data[0]) return byEmail.data[0];
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { action, plan } = JSON.parse(event.body || '{}');

    // Every billing action is tied to whoever is asking — never to an
    // arbitrary Stripe customer.
    const user = verifyKbToken(event.headers.authorization || event.headers.Authorization);

    // ── CREATE CHECKOUT ──────────────────────────────────────────
    if (action === 'create-checkout') {
      const priceId = process.env.STRIPE_PRICE_ID; // your $1.99/mo price ID

      let customer = await findCustomerFor(user);
      if (!customer) {
        customer = await stripe.customers.create({
          email: user.email || undefined,
          metadata: {
            plan: plan || 'pro',           // flat string values only
            userId: user.userId || '',
          },
        });
      }

      const session = await stripe.checkout.sessions.create({
        customer: customer.id,
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: 'subscription',
        success_url: process.env.SUCCESS_URL || 'https://ketobuddytracker.netlify.app/?upgraded=1',
        cancel_url:  process.env.CANCEL_URL  || 'https://ketobuddytracker.netlify.app/',
      });

      return {
        statusCode: 200,
        body: JSON.stringify({ url: session.url }),
      };
    }

    // ── CREATE PORTAL ────────────────────────────────────────────
    // Opens the billing portal for the signed-in user's OWN customer only.
    if (action === 'create-portal') {
      const customer = await findCustomerFor(user);
      if (!customer) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: 'No subscription found for your account yet — upgrade first, then manage it here.' }),
        };
      }

      const portal = await stripe.billingPortal.sessions.create({
        customer: customer.id,
        return_url: process.env.CANCEL_URL || 'https://ketobuddytracker.netlify.app/',
      });

      return {
        statusCode: 200,
        body: JSON.stringify({ url: portal.url }),
      };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    console.error('Stripe error:', err.message);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

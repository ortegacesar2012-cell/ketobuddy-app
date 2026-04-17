const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { action, plan, email, userId } = JSON.parse(event.body);

    // ── CREATE CHECKOUT ──────────────────────────────────────────
    if (action === 'create-checkout') {
      const priceId = process.env.STRIPE_PRICE_ID; // your $1.99/mo price ID

      // Find or create customer — metadata must be flat string key-value pairs
      let customer;
      if (email) {
        const existing = await stripe.customers.list({ email, limit: 1 });
        customer = existing.data[0];
      }

      if (!customer) {
        customer = await stripe.customers.create({
          email: email || undefined,
          metadata: {
            plan: plan || 'pro',           // ✅ flat string values only
            userId: userId ? String(userId) : '',
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
    if (action === 'create-portal') {
      const authHeader = event.headers.authorization || '';
      // Derive customer from email embedded in token or fallback
      const customers = await stripe.customers.list({ limit: 1 });
      const customer = customers.data[0];

      if (!customer) throw new Error('No customer found');

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

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MP_URL = 'https://api.mercadopago.com/v1/payments';
const PROD_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL
  : 'https://caneta-rho.vercel.app';

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

  // ── GET /api/checkout?type=pix-status&id=PAYMENT_ID ──
  if (req.method === 'GET' && req.query?.type === 'pix-status') {
    const id = req.query.id;
    if (!id) { res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'id required' })); return; }

    try {
      const r = await fetch(`${MP_URL}/${id}`, {
        headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
      });
      const p = await r.json();
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: p.status }));
    } catch (err) {
      res.writeHead(500, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

  // ── POST /api/checkout?type=pix ──
  if (req.query?.type === 'pix') {
    const { email, session_id } = body;
    if (!email) {
      res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'email obrigatório' }));
      return;
    }

    try {
      const r = await fetch(MP_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': session_id || (email + '-' + Date.now()),
        },
        body: JSON.stringify({
          transaction_amount: 34.90,
          description: 'Caneta Sem Medo — Guia Prático',
          payment_method_id: 'pix',
          payer: { email },
          notification_url: `${PROD_URL}/api/webhook?type=mp`,
          date_of_expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          metadata: { session_id: session_id || '', email },
        }),
      });
      const payment = await r.json();
      console.log('MP response:', JSON.stringify(payment).slice(0, 400));
      if (!r.ok || payment.error || !payment.point_of_interaction) {
        throw new Error(payment.message || payment.cause?.[0]?.description || `MP status ${r.status}`);
      }
      const pix = payment.point_of_interaction.transaction_data;
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        payment_id: payment.id,
        pix_code: pix?.qr_code || '',
        qr_base64: pix?.qr_code_base64 || '',
      }));
    } catch (err) {
      console.error('MP Pix error:', err.message);
      res.writeHead(500, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── POST /api/checkout (Stripe — página EN) ──
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: 'Shot Without Fear', description: 'GLP-1 Muscle & Habit Guide' },
          unit_amount: 900,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${req.headers.origin}/success.html`,
      cancel_url: `${req.headers.origin}/`,
    });
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ url: session.url }));
  } catch (err) {
    res.writeHead(500, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
};

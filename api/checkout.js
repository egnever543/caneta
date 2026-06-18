const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MP_URL = 'https://api.mercadopago.com/v1/payments';
const PROD_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL
  : 'https://caneta-rho.vercel.app';

async function sendPixChargeEmail(email, pix_code, qr_base64) {
  await resend.emails.send({
    from: 'Caneta Sem Medo <noreply@tvtecnologiavp.vip>',
    to: email,
    subject: '🔑 Seu Pix para acessar o Caneta Sem Medo',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#FAF6EF;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF6EF;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(30,46,44,0.10);">
        <tr>
          <td style="background:#163840;padding:32px 40px;text-align:center;">
            <p style="margin:0;font-family:Georgia,serif;font-size:22px;font-weight:700;color:#ffffff;">Caneta Sem Medo</p>
            <p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.65);">Guia Prático para o Tratamento com Injetáveis</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px;">
            <p style="margin:0 0 16px;font-size:17px;color:#1E2E2C;">Seu Pix está pronto! 🔑</p>
            <p style="margin:0 0 20px;font-size:15px;color:#54625F;line-height:1.7;">Escaneie o QR Code abaixo ou use o código Pix Copia e Cola para concluir seu pagamento de <strong>R$ 34,90</strong>. Assim que confirmado, enviaremos o guia no seu email.</p>
            ${qr_base64 ? `<div style="text-align:center;margin-bottom:20px;"><img src="data:image/png;base64,${qr_base64}" width="180" style="border-radius:8px;" alt="QR Code Pix"/></div>` : ''}
            <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#1F4E5A;">Pix Copia e Cola:</p>
            <div style="background:#F1EBDF;border-radius:8px;padding:14px 16px;margin-bottom:24px;word-break:break-all;font-size:12px;font-family:monospace;color:#333;">${pix_code}</div>
            <p style="margin:0;font-size:12px;color:#AAA;line-height:1.6;">⏱ O código expira em 30 minutos. Após o pagamento, o acesso ao guia é imediato.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 32px;">
            <p style="margin:0;font-size:12px;color:#AAA;line-height:1.6;border-top:1px solid #EFE7D8;padding-top:20px;">
              Dúvidas? Responda este email. Este é um produto educacional e não substitui orientação médica.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  });
}

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
          'X-Idempotency-Key': (session_id || email) + '-' + Date.now(),
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
      const pixCode = pix?.qr_code || '';
      const qrBase64 = pix?.qr_code_base64 || '';
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        payment_id: payment.id,
        pix_code: pixCode,
        qr_base64: qrBase64,
      }));
      // Envia email de cobrança com QR Code (não bloqueia a resposta)
      sendPixChargeEmail(email, pixCode, qrBase64).catch(e => console.error('Charge email error:', e.message));
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

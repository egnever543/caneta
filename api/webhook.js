const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const PDF_PT_URL = process.env.PDF_PT_URL || `https://caneta-rho.vercel.app/public/Shot_Without_Fear.pdf`;
const PDF_DOWNLOAD_URL = process.env.PDF_DOWNLOAD_URL || `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL : ''}/public/Shot_Without_Fear.pdf`;

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function sendEbookEmailPT(email) {
  await resend.emails.send({
    from: 'Caneta Sem Medo <noreply@tvtecnologiavp.vip>',
    to: email,
    subject: '✅ Pagamento confirmado — seu guia está pronto!',
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
            <p style="margin:0 0 16px;font-size:17px;color:#1E2E2C;">Olá! 🎉</p>
            <p style="margin:0 0 16px;font-size:15px;color:#54625F;line-height:1.7;">Seu pagamento foi confirmado! O seu guia <strong>Caneta Sem Medo</strong> está pronto para download agora mesmo.</p>
            <table cellpadding="0" cellspacing="0" style="margin:28px auto;">
              <tr>
                <td align="center" style="background:#CE9B4C;border-radius:999px;">
                  <a href="${PDF_PT_URL}" style="display:inline-block;padding:16px 36px;font-size:16px;font-weight:700;color:#163840;text-decoration:none;">Baixar meu Guia →</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:13px;color:#888;text-align:center;">Se o botão não funcionar, copie e cole este link:</p>
            <p style="margin:0 0 24px;font-size:12px;color:#CE9B4C;text-align:center;word-break:break-all;">${PDF_PT_URL}</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#F1EBDF;border-radius:12px;">
              <tr><td style="padding:20px 24px;">
                <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#1F4E5A;text-transform:uppercase;letter-spacing:0.08em;">O que está no seu guia</p>
                <p style="margin:4px 0;font-size:13px;color:#54625F;">✓ 9 capítulos práticos em PDF</p>
                <p style="margin:4px 0;font-size:13px;color:#54625F;">✓ Como preservar músculo durante o tratamento</p>
                <p style="margin:4px 0;font-size:13px;color:#54625F;">✓ Cardápios para dias de pouco apetite</p>
                <p style="margin:4px 0;font-size:13px;color:#54625F;">✓ Estratégia de saída para evitar o efeito sanfona</p>
                <p style="margin:4px 0;font-size:13px;color:#54625F;">✓ Bônus: Plano de 30 dias pós-tratamento</p>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 32px;">
            <p style="margin:24px 0 0;font-size:12px;color:#AAA;line-height:1.6;border-top:1px solid #EFE7D8;padding-top:20px;">
              Você está recebendo este email porque realizou a compra do Caneta Sem Medo. Dúvidas? Responda este email. Este é um produto educacional e não substitui orientação médica.
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
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  // ── Mercado Pago webhook ──
  if (req.query?.type === 'mp') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    console.log('MP webhook:', JSON.stringify(body).slice(0, 200));

    const paymentId = body.data?.id;
    if (body.type === 'payment' && paymentId) {
      try {
        const r = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
          headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
        });
        const payment = await r.json();
        console.log('MP payment status:', payment.status, '| email:', payment.metadata?.email || payment.payer?.email);
        if (payment.status === 'approved') {
          const email = payment.metadata?.email || payment.payer?.email;
          if (email) {
            await sendEbookEmailPT(email);
            console.log('Ebook PT sent to:', email);
          }
        }
      } catch (err) {
        console.error('MP webhook error:', err.message);
      }
    }
    return res.status(200).json({ received: true });
  }

  // ── Stripe webhook ──

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerEmail = session.customer_details?.email;
    const customerName = session.customer_details?.name || 'there';

    if (customerEmail) {
      try {
        await resend.emails.send({
          from: 'Shot Without Fear <noreply@tvtecnologiavp.vip>',
          to: customerEmail,
          subject: 'Your guide is ready — Shot Without Fear',
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
            <p style="margin:0;font-family:Georgia,serif;font-size:22px;font-weight:700;color:#ffffff;">Shot Without Fear</p>
            <p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.65);">GLP-1 Muscle &amp; Habit Guide</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px;">
            <p style="margin:0 0 16px;font-size:17px;color:#1E2E2C;">Hi ${customerName},</p>
            <p style="margin:0 0 16px;font-size:15px;color:#54625F;line-height:1.7;">Your purchase is confirmed — thank you! Your guide is ready to download right now.</p>
            <table cellpadding="0" cellspacing="0" style="margin:28px auto;">
              <tr>
                <td align="center" style="background:#CE9B4C;border-radius:999px;">
                  <a href="${PDF_DOWNLOAD_URL}" style="display:inline-block;padding:16px 36px;font-size:16px;font-weight:700;color:#163840;text-decoration:none;">Download Your Guide →</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:13px;color:#888;text-align:center;">If the button doesn't work, copy and paste this link:</p>
            <p style="margin:0 0 24px;font-size:12px;color:#CE9B4C;text-align:center;word-break:break-all;">${PDF_DOWNLOAD_URL}</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#F1EBDF;border-radius:12px;">
              <tr><td style="padding:20px 24px;">
                <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#1F4E5A;text-transform:uppercase;letter-spacing:0.08em;">What's inside your guide</p>
                <p style="margin:4px 0;font-size:13px;color:#54625F;">&#10003; 9 practical chapters, zero fluff</p>
                <p style="margin:4px 0;font-size:13px;color:#54625F;">&#10003; Protein tables &amp; workout template</p>
                <p style="margin:4px 0;font-size:13px;color:#54625F;">&#10003; Meal plans for low &amp; moderate appetite days</p>
                <p style="margin:4px 0;font-size:13px;color:#54625F;">&#10003; Exit strategy to prevent the rebound</p>
                <p style="margin:4px 0;font-size:13px;color:#54625F;">&#10003; Weekly habit checklist</p>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 32px;">
            <p style="margin:24px 0 0;font-size:12px;color:#AAA;line-height:1.6;border-top:1px solid #EFE7D8;padding-top:20px;">
              You're receiving this because you purchased Shot Without Fear. Questions? Reply to this email and we'll help right away. This is an educational product and does not replace medical advice.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
        });
        console.log('Email sent to:', customerEmail);
      } catch (emailErr) {
        console.error('Email send error:', emailErr);
      }
    }
  }

  res.status(200).json({ received: true });
};

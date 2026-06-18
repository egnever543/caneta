const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const DOWNLOAD_PAGE = process.env.DOWNLOAD_PAGE_URL || 'https://caneta-rho.vercel.app/public/download.html';

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function ebookEmailHTML(title, subtitle, greeting, bodyText, btnText, footerText) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#FAF6EF;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF6EF;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(30,46,44,0.10);">
        <tr>
          <td style="background:#163840;padding:32px 40px;text-align:center;">
            <p style="margin:0;font-family:Georgia,serif;font-size:22px;font-weight:700;color:#ffffff;">${title}</p>
            <p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.65);">${subtitle}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px;">
            <p style="margin:0 0 16px;font-size:17px;color:#1E2E2C;">${greeting}</p>
            <p style="margin:0 0 28px;font-size:15px;color:#54625F;line-height:1.7;">${bodyText}</p>
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
              <tr>
                <td align="center" style="background:#CE9B4C;border-radius:999px;">
                  <a href="${DOWNLOAD_PAGE}" style="display:inline-block;padding:16px 36px;font-size:16px;font-weight:700;color:#163840;text-decoration:none;">${btnText}</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:13px;color:#888;text-align:center;">Se o botão não funcionar, copie e cole este link:</p>
            <p style="margin:0 0 24px;font-size:12px;color:#CE9B4C;text-align:center;word-break:break-all;">${DOWNLOAD_PAGE}</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#F1EBDF;border-radius:12px;">
              <tr><td style="padding:20px 24px;">
                <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#1F4E5A;text-transform:uppercase;letter-spacing:0.08em;">O que está incluso</p>
                <p style="margin:4px 0;font-size:13px;color:#54625F;">📖 Caneta Sem Medo — guia completo em Português</p>
                <p style="margin:4px 0;font-size:13px;color:#54625F;">🌎 Shot Without Fear — versão em Inglês</p>
                <p style="margin:4px 0;font-size:13px;color:#54625F;">🎁 Bônus: Plano de 30 Dias Pós-Tratamento</p>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 32px;">
            <p style="margin:24px 0 0;font-size:12px;color:#AAA;line-height:1.6;border-top:1px solid #EFE7D8;padding-top:20px;">${footerText}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendEbookEmailPT(email) {
  await resend.emails.send({
    from: 'Caneta Sem Medo <noreply@tvtecnologiavp.vip>',
    to: email,
    subject: '✅ Pagamento confirmado — seus materiais estão prontos!',
    html: ebookEmailHTML(
      'Caneta Sem Medo',
      'Guia Prático para o Tratamento com Injetáveis',
      'Olá! 🎉',
      'Seu pagamento foi confirmado! Todos os seus materiais estão prontos para download — incluindo o guia completo, a versão em inglês e o bônus.',
      'Acessar meus materiais →',
      'Você está recebendo este email porque realizou a compra do Caneta Sem Medo. Dúvidas? Responda este email. Este é um produto educacional e não substitui orientação médica.'
    ),
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  // ── Mercado Pago webhook ──
  if (req.query?.type === 'mp') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    console.log('MP webhook:', JSON.stringify(body).slice(0, 200));

    // Suporte ao formato IPN antigo: {resource: "...id", topic: "payment"}
    // e ao formato Webhook novo: {type: "payment", data: {id: "..."}}
    let paymentId = body.data?.id;
    if (!paymentId && body.topic === 'payment') {
      // resource pode ser URL ou ID direto
      const resource = body.resource || '';
      paymentId = resource.toString().split('/').pop();
    }
    if ((body.type === 'payment' || body.topic === 'payment') && paymentId) {
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
          subject: '✅ Your materials are ready — Shot Without Fear',
          html: ebookEmailHTML(
            'Shot Without Fear',
            'GLP-1 Muscle &amp; Habit Guide',
            `Hi ${customerName}! 🎉`,
            'Your purchase is confirmed — thank you! All your materials are ready to download, including the full guide, the Portuguese version, and the bonus plan.',
            'Access my materials →',
            "You're receiving this because you purchased Shot Without Fear. Questions? Reply to this email. This is an educational product and does not replace medical advice."
          ),
        });
        console.log('Email sent to:', customerEmail);
      } catch (emailErr) {
        console.error('Email send error:', emailErr);
      }
    }
  }

  res.status(200).json({ received: true });
};

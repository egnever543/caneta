const PIXEL_ID = '3387796061379965';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ ok: false, error: 'META_ACCESS_TOKEN not set' });

  const {
    event_name = 'InitiateCheckout',
    event_source_url,
    fbclid,
    client_ip_address,
    client_user_agent,
    event_time,
    custom_data = {}
  } = req.body || {};

  // Get real IP from request if not provided
  const ip = client_ip_address ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    null;

  const userData = { client_user_agent: client_user_agent || null };
  if (fbclid) userData.fbc = `fb.1.${Date.now()}.${fbclid}`;
  if (ip) userData.client_ip_address = ip;

  const payload = {
    data: [{
      event_name,
      event_time: event_time || Math.floor(Date.now() / 1000),
      event_source_url: event_source_url || 'https://caneta-rho.vercel.app/',
      action_source: 'website',
      user_data: userData,
      custom_data
    }]
  };

  try {
    const fbRes = await fetch(
      `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );
    const json = await fbRes.json();
    if (!fbRes.ok) return res.status(400).json({ ok: false, error: json });
    return res.status(200).json({ ok: true, result: json });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};

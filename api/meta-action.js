module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const token = process.env.META_ACCESS_TOKEN;
  const base = 'https://graph.facebook.com/v19.0';
  const { action, id, value } = req.body;

  try {
    let url, body;

    if (action === 'toggle_campaign') {
      // value: 'ACTIVE' | 'PAUSED'
      url = `${base}/${id}`;
      body = { status: value, access_token: token };
    } else if (action === 'toggle_adset') {
      url = `${base}/${id}`;
      body = { status: value, access_token: token };
    } else if (action === 'set_budget') {
      // value: budget in cents (USD), e.g. 1000 = $10.00
      url = `${base}/${id}`;
      body = { daily_budget: value, access_token: token };
    } else {
      return res.status(400).json({ error: 'Unknown action' });
    }

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await r.json();

    if (json.error) throw new Error(json.error.message);
    res.status(200).json({ ok: true, result: json });
  } catch (err) {
    console.error('Meta action error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

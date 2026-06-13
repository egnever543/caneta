const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { session_id, event_type, section, metadata } = req.body;

    if (!session_id || !event_type) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { error } = await supabase.from('page_events').insert({
      session_id,
      event_type,
      section: section || null,
      metadata: metadata || {},
      country: req.headers['x-vercel-ip-country'] || null,
      user_agent: req.headers['user-agent'] || null,
    });

    if (error) throw error;

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Track error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

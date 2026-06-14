module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const token = process.env.META_ACCESS_TOKEN;
  const rawId = process.env.META_AD_ACCOUNT_ID || '';
  const accountId = rawId.startsWith('act_') ? rawId : `act_${rawId}`;
  const base = 'https://graph.facebook.com/v19.0';

  try {
    // Return adsets for a specific campaign
    if (req.query.type === 'adsets') {
      const campaignId = req.query.campaign_id;
      if (!campaignId) return res.status(400).json({ error: 'campaign_id required' });
      const r = await fetch(`${base}/${campaignId}/adsets?fields=id,name,daily_budget,status,targeting&access_token=${token}`);
      const json = await r.json();
      if (json.error) return res.status(200).json({ error: json.error.message });
      return res.status(200).json({ adsets: json.data || [] });
    }

    // Default: return pages + pixels + active campaigns in parallel
    const [pagesRes, pixelsRes, campsRes] = await Promise.all([
      fetch(`${base}/me/accounts?fields=id,name&limit=50&access_token=${token}`),
      fetch(`${base}/${accountId}/adspixels?fields=id,name&access_token=${token}`),
      fetch(`${base}/${accountId}/campaigns?fields=id,name,status,objective&filtering=[{"field":"effective_status","operator":"IN","value":["ACTIVE"]}]&limit=50&access_token=${token}`),
    ]);

    const [pages, pixels, camps] = await Promise.all([
      pagesRes.json(), pixelsRes.json(), campsRes.json(),
    ]);

    res.status(200).json({
      ok: true,
      pages: pages.data || [],
      pixels: pixels.data || [],
      campaigns: camps.data || [],
    });
  } catch (err) {
    console.error('meta-assets error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).end();

  const token = process.env.META_ACCESS_TOKEN;
  const rawId = process.env.META_AD_ACCOUNT_ID || '';
  const accountId = rawId.startsWith('act_') ? rawId : `act_${rawId}`;
  const base = 'https://graph.facebook.com/v19.0';

  try {
    // Campaigns with today + lifetime insights
    const [campaignsRes, insightsRes, adsetsRes] = await Promise.all([
      fetch(`${base}/${accountId}/campaigns?fields=id,name,status,daily_budget,lifetime_budget,objective&limit=20&access_token=${token}`),
      fetch(`${base}/${accountId}/insights?fields=campaign_id,campaign_name,impressions,clicks,spend,cpm,cpc,ctr,reach,actions&date_preset=last_7d&level=campaign&limit=20&access_token=${token}`),
      fetch(`${base}/${accountId}/adsets?fields=id,name,status,daily_budget,campaign_id,targeting&limit=50&access_token=${token}`),
    ]);

    const [campaigns, insights, adsets] = await Promise.all([
      campaignsRes.json(),
      insightsRes.json(),
      adsetsRes.json(),
    ]);

    // Expose raw error for debugging
    if (campaigns.error) {
      return res.status(200).json({ ok: false, debug: { campaigns, tokenPrefix: (process.env.META_ACCESS_TOKEN||'').slice(0,20) } });
    }

    // Merge insights into campaigns
    const insightMap = {};
    (insights.data || []).forEach(i => { insightMap[i.campaign_id] = i; });

    const merged = (campaigns.data || []).map(c => ({
      ...c,
      insights: insightMap[c.id] || null,
      adsets: (adsets.data || []).filter(a => a.campaign_id === c.id),
    }));

    res.status(200).json({ ok: true, campaigns: merged });
  } catch (err) {
    console.error('Meta insights error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).end();

  const token = process.env.META_ACCESS_TOKEN;
  const rawId = process.env.META_AD_ACCOUNT_ID || '';
  const accountId = rawId.startsWith('act_') ? rawId : `act_${rawId}`;
  const base = 'https://graph.facebook.com/v19.0';
  const days = req.query.days || '7';
  const datePreset = days === 'today' ? 'today' : days === '30' ? 'last_30d' : days === '14' ? 'last_14d' : 'last_7d';

  const insightFields = 'campaign_id,campaign_name,impressions,clicks,spend,cpm,cpc,ctr,reach,actions';

  try {
    const [campaignsRes, insightsRes, dailyRes, adsetsRes, adsRes, accountRes] = await Promise.all([
      fetch(`${base}/${accountId}/campaigns?fields=id,name,status,daily_budget,lifetime_budget,objective&limit=50&access_token=${token}`),
      fetch(`${base}/${accountId}/insights?fields=${insightFields}&date_preset=${datePreset}&level=campaign&limit=50&access_token=${token}`),
      fetch(`${base}/${accountId}/insights?fields=${insightFields}&date_preset=${datePreset}&time_increment=1&level=account&limit=100&access_token=${token}`),
      fetch(`${base}/${accountId}/adsets?fields=id,name,status,daily_budget,campaign_id&limit=100&access_token=${token}`),
      fetch(`${base}/${accountId}/ads?fields=id,name,status,adset_id,campaign_id,creative{id,name,thumbnail_url}&limit=100&access_token=${token}`),
      fetch(`${base}/${accountId}?fields=currency&access_token=${token}`),
    ]);

    const [campaigns, insights, daily, adsets, ads, account] = await Promise.all([
      campaignsRes.json(),
      insightsRes.json(),
      dailyRes.json(),
      adsetsRes.json(),
      adsRes.json(),
      accountRes.json(),
    ]);

    if (campaigns.error) {
      return res.status(200).json({ ok: false, error: campaigns.error.message });
    }

    const currency = account.currency || 'USD';

    const insightMap = {};
    (insights.data || []).forEach(i => { insightMap[i.campaign_id] = i; });

    const merged = (campaigns.data || []).map(c => ({
      ...c,
      insights: insightMap[c.id] || null,
      adsets: (adsets.data || []).filter(a => a.campaign_id === c.id),
      ads: (ads.data || []).filter(a => a.campaign_id === c.id),
    }));

    const dailySorted = (daily.data || []).sort((a, b) => a.date_start.localeCompare(b.date_start));

    res.status(200).json({ ok: true, campaigns: merged, daily: dailySorted, currency });
  } catch (err) {
    console.error('Meta insights error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

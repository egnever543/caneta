const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function fetchMetaInsights() {
  const accountId = process.env.META_AD_ACCOUNT_ID;
  const token = process.env.META_ACCESS_TOKEN;
  const base = 'https://graph.facebook.com/v19.0';

  // Campaign-level insights for yesterday
  const insightsRes = await fetch(
    `${base}/${accountId}/insights?fields=campaign_name,campaign_id,impressions,clicks,spend,cpm,cpc,ctr,reach,actions&date_preset=yesterday&level=campaign&access_token=${token}`
  );
  const insights = await insightsRes.json();

  // Active campaigns
  const campaignsRes = await fetch(
    `${base}/${accountId}/campaigns?fields=id,name,status,daily_budget,lifetime_budget&access_token=${token}`
  );
  const campaigns = await campaignsRes.json();

  // Ad sets
  const adsetsRes = await fetch(
    `${base}/${accountId}/adsets?fields=id,name,status,daily_budget,targeting&limit=20&access_token=${token}`
  );
  const adsets = await adsetsRes.json();

  return {
    insights: insights.data || [],
    campaigns: campaigns.data || [],
    adsets: adsets.data || [],
  };
}

async function analyzeWithClaude(metaData, siteData) {
  const prompt = `You are a performance marketing analyst specialized in Meta Ads for digital products.

## Meta Ads Data (Yesterday)

### Campaign Insights
${JSON.stringify(metaData.insights, null, 2)}

### Active Campaigns
${JSON.stringify(metaData.campaigns, null, 2)}

### Ad Sets
${JSON.stringify(metaData.adsets, null, 2)}

## Site Analytics (Last 7 days from our tracking)
- Total visits: ${siteData.visits}
- CTA clicks: ${siteData.ctas}
- Purchases confirmed: ${siteData.purchases}
- Click rate (visits → CTA): ${siteData.ctr}%
- Top countries: ${siteData.countries}

## Product Context
- Product: "Shot Without Fear" — $9 digital ebook for GLP-1 medication users (Ozempic, Mounjaro, Wegovy)
- Target: US market, 35-65yo, mostly women
- Goal: maximize purchases at lowest possible CPA

## Your Task
Analyze the campaign performance and provide:

1. **Summary** — 2-3 sentences on overall performance in plain language
2. **What's working** — specific positives with data to back it up
3. **What's not working** — specific issues with data
4. **Recommendations** — 3 concrete actions ranked by priority (include the specific campaign/adset name when relevant)
5. **Risk alerts** — anything that needs immediate attention

Be direct, specific, and data-driven. If data is insufficient (campaign just started), say so and recommend waiting for more data before making changes. Never recommend changes during the learning phase (first 7 days) unless there's a critical issue.

Respond in JSON with this exact structure:
{
  "summary": "string",
  "working": ["string"],
  "not_working": ["string"],
  "recommendations": [
    { "priority": 1, "action": "string", "reason": "string", "impact": "high|medium|low" }
  ],
  "alerts": ["string"],
  "learning_phase": true|false
}`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text;
  const match = text.match(/\{[\s\S]*\}/);
  return match ? JSON.parse(match[0]) : { summary: text, recommendations: [], alerts: [] };
}

async function getSiteData() {
  const { data } = await supabase
    .from('page_events')
    .select('event_type, session_id, country')
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

  if (!data) return { visits: 0, ctas: 0, purchases: 0, ctr: 0, countries: 'N/A' };

  const visits = new Set(data.filter(e => e.event_type === 'page_view').map(e => e.session_id)).size;
  const ctas = data.filter(e => e.event_type === 'cta_click').length;
  const purchases = data.filter(e => e.event_type === 'purchase').length;
  const countries = [...new Set(data.map(e => e.country).filter(Boolean))].slice(0, 5).join(', ');

  return { visits, ctas, purchases, ctr: visits ? Math.round(ctas / visits * 100) : 0, countries };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Allow manual trigger via GET, cron via GET too
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  try {
    const [metaData, siteData] = await Promise.all([fetchMetaInsights(), getSiteData()]);
    const analysis = await analyzeWithClaude(metaData, siteData);

    const today = new Date().toISOString().slice(0, 10);

    // Upsert — replace today's report if already exists
    const { error } = await supabase
      .from('ai_reports')
      .upsert({ report_date: today, meta_data: metaData, analysis: analysis.summary, recommendations: analysis }, { onConflict: 'report_date' });

    if (error) throw error;

    res.status(200).json({ ok: true, date: today, analysis });
  } catch (err) {
    console.error('Daily report error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

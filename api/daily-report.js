const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function fetchMetaInsights() {
  const rawId = process.env.META_AD_ACCOUNT_ID || '';
  const accountId = rawId.startsWith('act_') ? rawId : `act_${rawId}`;
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
  const prompt = `Você é um analista de performance especializado em Meta Ads para produtos digitais. Responda sempre em português do Brasil, de forma direta e objetiva.

## Dados Meta Ads (Ontem)

### Campaign Insights
${JSON.stringify(metaData.insights, null, 2)}

### Active Campaigns
${JSON.stringify(metaData.campaigns, null, 2)}

### Ad Sets
${JSON.stringify(metaData.adsets, null, 2)}

## Analytics do Site (Últimos 7 dias)
- Visitas únicas: ${siteData.visits}
- Cliques no CTA: ${siteData.ctas}
- Compras confirmadas: ${siteData.purchases}
- Taxa de clique (visitas → CTA): ${siteData.ctr}%
- Principais países: ${siteData.countries}

## Contexto do Produto
- Produto: "Shot Without Fear" — ebook digital de $9 para usuários de GLP-1 (Ozempic, Mounjaro, Wegovy)
- Mercado-alvo: EUA, 35-65 anos, maioria mulheres
- Objetivo: maximizar compras com o menor CPA possível

## Sua Tarefa
Analise a performance da campanha e forneça:

1. **Resumo** — 2-3 frases sobre a performance geral em linguagem simples
2. **O que está funcionando** — pontos positivos com dados concretos
3. **O que não está funcionando** — problemas identificados com dados
4. **Recomendações** — 3 ações concretas por prioridade (inclua o nome da campanha/conjunto quando relevante)
5. **Alertas** — qualquer coisa que precise de atenção imediata

Seja direto, específico e baseado em dados. Se os dados forem insuficientes (campanha recém-iniciada), diga isso e recomende aguardar mais dados antes de fazer mudanças. Nunca recomende alterações durante a fase de aprendizado (primeiros 7 dias) a menos que haja um problema crítico.

Responda em JSON com esta estrutura exata:
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
  // Strip markdown fences, find outermost JSON object, fix trailing commas
  const cleaned = text.replace(/```(?:json)?\n?/g, '').replace(/```/g, '');
  const start = cleaned.indexOf('{');
  if (start === -1) return { summary: text, recommendations: [], alerts: [] };
  let depth = 0, end = -1;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === '{') depth++;
    else if (cleaned[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return { summary: text, recommendations: [], alerts: [] };
  const fixed = cleaned.slice(start, end + 1).replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(fixed);
  } catch(e) {
    console.error('JSON parse failed after repair:', e.message, fixed.slice(0, 200));
    return { summary: text, recommendations: [], alerts: [] };
  }
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

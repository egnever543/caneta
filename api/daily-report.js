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

  // Last 7 days at campaign level
  const insightsRes = await fetch(
    `${base}/${accountId}/insights?fields=campaign_name,campaign_id,ad_name,ad_id,impressions,clicks,spend,cpm,cpc,ctr,reach,actions&date_preset=last_7d&level=ad&limit=50&access_token=${token}`
  );
  const insights = await insightsRes.json();

  // Active campaigns
  const campaignsRes = await fetch(
    `${base}/${accountId}/campaigns?fields=id,name,status,daily_budget,lifetime_budget&filtering=[{"field":"effective_status","operator":"IN","value":["ACTIVE"]}]&access_token=${token}`
  );
  const campaigns = await campaignsRes.json();

  return {
    insights: insights.data || [],
    campaigns: campaigns.data || [],
  };
}

async function fetchCreatives() {
  const res = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/creatives?select=name,hook_type,hook_score,visual_elements,dominant_colors,has_person,tone,ctr,cpc,impressions,clicks,spend,analysis_notes,analyzed_at&analyzed_at=not.is.null&order=ctr.desc&limit=20`,
    { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}` } }
  );
  return res.json();
}

async function analyzeWithClaude(metaData, siteData, creatives) {
  const topCreatives = (creatives || []).slice(0, 10).map(c => ({
    name: c.name,
    hook_type: c.hook_type,
    hook_score: c.hook_score,
    tone: c.tone,
    has_person: c.has_person,
    visual_elements: c.visual_elements,
    ctr: c.ctr,
    cpc: c.cpc,
    impressions: c.impressions,
    clicks: c.clicks,
    spend: c.spend,
    notes: c.analysis_notes,
  }));

  const prompt = `Você é um analista de performance especializado em Meta Ads para produtos digitais. Responda sempre em português do Brasil, de forma direta e objetiva.

## Dados Meta Ads (Últimos 7 dias — nível de anúncio)

### Performance por Anúncio
${JSON.stringify(metaData.insights, null, 2)}

### Campanhas Ativas
${JSON.stringify(metaData.campaigns, null, 2)}

## Análise de Criativos (Claude Vision — top ${topCreatives.length} por CTR)
${JSON.stringify(topCreatives, null, 2)}

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
Cruze os dados de performance dos anúncios com a análise dos criativos e forneça:

1. **Resumo** — 2-3 frases sobre a performance geral em linguagem simples
2. **O que está funcionando** — quais tipos de hook, elementos visuais e tons estão gerando melhor CTR/CPC com dados concretos
3. **O que não está funcionando** — criativos, hooks ou padrões visuais com performance abaixo da média
4. **Recomendações** — 3-5 ações concretas por prioridade: pausar criativos fracos, duplicar os que funcionam, testar variações específicas
5. **Próximo criativo** — descreva em 2-3 frases o criativo ideal a criar baseado nos padrões vencedores identificados
6. **Alertas** — qualquer coisa crítica que precise de atenção imediata

Seja direto, específico e baseado em dados. Mencione nomes de criativos quando relevante.

Responda em JSON com esta estrutura exata:
{
  "summary": "string",
  "working": ["string"],
  "not_working": ["string"],
  "recommendations": [
    { "priority": 1, "action": "string", "reason": "string", "impact": "high|medium|low" }
  ],
  "next_creative": "string",
  "alerts": ["string"],
  "learning_phase": true|false
}`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 3072,
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
    const [metaData, siteData, creatives] = await Promise.all([fetchMetaInsights(), getSiteData(), fetchCreatives()]);
    const analysis = await analyzeWithClaude(metaData, siteData, creatives);

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

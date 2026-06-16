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

async function analyzeWithClaude(metaData, siteData, creatives, persona) {
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

${personaContext(persona)}

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

  return parseJSON(response.content[0].text);
}

function parseJSON(text) {
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

async function getSiteData(pageFilter) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('page_events')
    .select('event_type, session_id, country, metadata, created_at')
    .gte('created_at', since)
    .limit(2000);

  if (!data) return { visits: 0, ctas: 0, purchases: 0, ctr: 0, countries: 'N/A', sources: {}, daily: {}, scrollDepth: {}, utmFunnel: {}, page: pageFilter || 'all' };

  // Filter directly by event URL — every event now carries metadata.url
  const getPath = url => { try { return new URL(url).pathname.replace(/\/$/, '') || '/'; } catch { return null; } };
  const filteredData = pageFilter
    ? data.filter(e => getPath(e.metadata?.url) === pageFilter)
    : data;
  const sessions = filteredData.filter(e => e.event_type === 'page_view');
  const visits = new Set(sessions.map(e => e.session_id)).size;
  const ctas = filteredData.filter(e => e.event_type === 'cta_click').length;
  const purchases = filteredData.filter(e => e.event_type === 'purchase').length;
  const countries = [...new Set(filteredData.map(e => e.country).filter(Boolean))].slice(0, 5).join(', ');

  // UTM source breakdown
  const sources = {};
  sessions.forEach(e => {
    const src = e.metadata?.utm_source || 'direct';
    sources[src] = (sources[src] || 0) + 1;
  });

  // Daily visits
  const daily = {};
  sessions.forEach(e => {
    const day = e.created_at?.slice(0, 10);
    if (day) daily[day] = (daily[day] || 0) + 1;
  });

  // Scroll depth — % of sessions that reached each threshold
  const sessionScrollMax = {};
  filteredData.filter(e => e.event_type === 'scroll_depth').forEach(e => {
    const pct = e.metadata?.percent || 0;
    if (!sessionScrollMax[e.session_id] || sessionScrollMax[e.session_id] < pct)
      sessionScrollMax[e.session_id] = pct;
  });
  const scrollDepth = {};
  [25, 50, 75, 90].forEach(t => {
    const n = Object.values(sessionScrollMax).filter(p => p >= t).length;
    scrollDepth[t] = visits ? Math.round(n / visits * 100) : 0;
  });

  // UTM funnel — visits/ctas/purchases per source (join by session_id)
  const sessionToUtm = {};
  sessions.forEach(e => { sessionToUtm[e.session_id] = e.metadata?.utm_source || 'direct'; });
  const utmFunnel = {};
  filteredData.forEach(e => {
    const src = sessionToUtm[e.session_id] || 'direct';
    if (!utmFunnel[src]) utmFunnel[src] = { visits: 0, ctas: 0, purchases: 0 };
    if (e.event_type === 'page_view') utmFunnel[src].visits++;
    if (e.event_type === 'cta_click') utmFunnel[src].ctas++;
    if (e.event_type === 'purchase') utmFunnel[src].purchases++;
  });

  return { visits, ctas, purchases, ctr: visits ? Math.round(ctas / visits * 100) : 0, countries, sources, daily, scrollDepth, utmFunnel, page: pageFilter || 'all' };
}

async function fetchRecentChanges() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data } = await supabase
    .from('change_log')
    .select('id, change_date, category, title, hypothesis, metrics_before, verdict, verdict_note, verdict_at')
    .gte('change_date', since)
    .order('change_date', { ascending: false })
    .limit(10);
  return data || [];
}

function computeVerdict(change, currentMetrics) {
  const before = change.metrics_before || {};
  const daysAgo = Math.floor((Date.now() - new Date(change.change_date)) / 86400000);
  if (daysAgo < 7) return null;
  if (!before.visits || before.visits < 15)
    return { verdict: 'baseline_insuficiente', verdict_note: `Menos de 15 visitas registradas antes da mudança.` };
  if (!currentMetrics.visits || currentMetrics.visits < 15)
    return { verdict: 'aguardando_dados', verdict_note: `Menos de 15 visitas após a mudança — aguardando tráfego.` };
  const ctrBefore = before.ctr || 0;
  const ctrNow = currentMetrics.ctr || 0;
  const delta = ctrBefore > 0 ? (ctrNow - ctrBefore) / ctrBefore : (ctrNow > 0 ? 1 : 0);
  const sign = delta >= 0 ? '+' : '';
  const note = `CTR ${ctrBefore}% → ${ctrNow}% (${sign}${Math.round(delta * 100)}%)`;
  if (delta >= 0.15) return { verdict: 'confirmada', verdict_note: note };
  if (delta <= -0.15) return { verdict: 'rejeitada', verdict_note: note };
  return { verdict: 'inconclusivo', verdict_note: note };
}

function changesContext(changes) {
  if (!changes.length) return '';
  const lines = changes.map(c => {
    const daysAgo = Math.floor((Date.now() - new Date(c.change_date).getTime()) / 86400000);
    const m = c.metrics_before || {};
    const snap = `CTR ${m.ctr ?? '?'}%, ${m.visits ?? '?'} visitas, ${m.purchases ?? '?'} compras`;
    return `- ${c.change_date} (${daysAgo}d atrás) [${c.category}]: ${c.title}${c.hypothesis ? ` | Hipótese: ${c.hypothesis}` : ''} | Métricas no momento: ${snap}`;
  }).join('\n');
  return `\nMUDANÇAS RECENTES (últimos 30 dias — correlacione com métricas atuais):\n${lines}\n`;
}

async function analyzeSiteWithClaude(siteData, persona, changes) {
  const convRate = siteData.visits ? ((siteData.purchases / siteData.visits) * 100).toFixed(2) : 0;
  const topSources = Object.entries(siteData.sources || {}).slice(0, 3).map(([k,v]) => `${k}:${v}`).join(', ');

  const sd = siteData.scrollDepth || {};
  const scrollCtx = Object.keys(sd).length
    ? `Scroll depth (% sessões): ${Object.entries(sd).map(([t,p]) => `até ${t}%→${p}% users`).join(', ')}`
    : '';

  const utmCtx = Object.entries(siteData.utmFunnel || {}).slice(0, 5)
    .map(([src, f]) => `${src}: ${f.visits}v / ${f.ctas}c / ${f.purchases}p`)
    .join(' | ');

  const prompt = `${personaContext(persona)}
${changesContext(changes)}
Funil CRO 7d: visitas=${siteData.visits} ctas=${siteData.ctas} compras=${siteData.purchases} ctr=${siteData.ctr}% conv=${convRate}%
Fontes: ${topSources||'n/a'}
${scrollCtx ? scrollCtx : ''}
${utmCtx ? `Funil por fonte: ${utmCtx}` : ''}
Benchmarks produto digital $9: CTR esperado 1-3%, conversão 2-5%, CPC alvo <$2.

Se houver mudanças recentes, avalie se as hipóteses se confirmaram. Use scroll depth para identificar onde usuários abandonam.
Responda SOMENTE JSON válido, sem markdown, texto curto, máximo 2 recomendações:
{"summary":"…","funnel_health":"saudável|atenção|crítico","working":["…"],"friction_points":["…"],"recommendations":[{"priority":1,"action":"…","reason":"…","impact":"high"}],"best_source":"…","alerts":["…"]}`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 900,
    messages: [{ role: 'user', content: prompt }],
  });

  return parseJSON(response.content[0].text);
}

async function fetchPersona() {
  const { data } = await supabase.from('persona').select('*').eq('id', 1).single();
  return data || {};
}

function personaContext(p) {
  if (!p || !p.product_name) return '';
  const desires = (p.desires || []).join('; ');
  const pains = (p.pains || []).join('; ');
  return `
PERSONA & PRODUTO (fonte de verdade — priorize sempre):
Produto: ${p.product_name} | Preço: ${p.product_price || '?'} | ${p.product_description || ''}
Público: ${p.gender || ''}, ${p.age_range || ''}, ${p.location || ''}
Desejos: ${desires || 'não definidos'}
Dores: ${pains || 'não definidas'}
Proposta de valor: ${p.value_proposition || ''}
Tom: ${p.tone || ''}
Objetivo: ${p.goals || ''}`.trim();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const type = req.query.type || 'campaign';

  try {
    // ── Facebook Conversions API ──
    if (type === 'fb-event' && req.method === 'POST') {
      const PIXEL_ID = '3387796061379965';
      const token = process.env.META_ACCESS_TOKEN;
      if (!token) return res.status(500).json({ ok: false, error: 'META_ACCESS_TOKEN not set' });

      const {
        event_name = 'InitiateCheckout',
        event_source_url,
        fbclid,
        fbp,
        external_id,
        client_user_agent,
        event_time,
        custom_data = {}
      } = req.body || {};

      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;
      // Prefer user-agent from HTTP header (always present), fall back to client-sent value
      const ua = req.headers['user-agent'] || client_user_agent || null;
      const userData = {};
      if (ua) userData.client_user_agent = ua;
      if (ip) userData.client_ip_address = ip;
      if (fbclid) userData.fbc = `fb.1.${Date.now()}.${fbclid}`;
      if (fbp) userData.fbp = fbp;
      if (external_id) userData.external_id = external_id;

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

      const fbRes = await fetch(
        `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${token}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      );
      const fbJson = await fbRes.json();
      if (!fbRes.ok) return res.status(400).json({ ok: false, error: fbJson });
      return res.status(200).json({ ok: true, result: fbJson });
    }

    // ── Apply AI suggestion (read → Claude → commit → log) ──
    if (type === 'apply' && req.method === 'POST') {
      const { recommendation, reason } = req.body;
      if (!recommendation) return res.status(400).json({ ok: false, error: 'recommendation required' });

      const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
      const GITHUB_REPO = process.env.GITHUB_REPO || 'egnever543/caneta';
      const FILE_PATH = 'landing-page-needle-no-fear.html';
      const API = `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}`;

      // 1. Fetch current file from GitHub
      const ghRes = await fetch(API, {
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'User-Agent': 'ShotWithoutFear-Bot' }
      });
      if (!ghRes.ok) throw new Error(`GitHub read failed: ${ghRes.status}`);
      const ghJson = await ghRes.json();
      const currentSha = ghJson.sha;
      const currentHtml = Buffer.from(ghJson.content, 'base64').toString('utf-8');

      // 2. Ask Claude to apply the change
      const persona = await fetchPersona();
      const pCtx = personaContext(persona);
      const applyPrompt = `Você é um especialista em CRO e copywriting para landing pages.

${pCtx ? pCtx + '\n\n' : ''}Aplique EXATAMENTE esta mudança na landing page abaixo:

MUDANÇA A APLICAR:
${recommendation}

REGRAS OBRIGATÓRIAS:
- Retorne SOMENTE o HTML completo modificado, sem explicações, sem markdown
- Não altere nada além do que a mudança especifica
- Preserve todos os scripts, tracking, estilos e estrutura existentes
- Mantenha o Clarity e Meta Pixel intactos

HTML ATUAL:
${currentHtml}`;

      const applyTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout ao aplicar mudança — tente novamente')), 25000)
      );
      const claudeCall = anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        messages: [{ role: 'user', content: applyPrompt }],
      });
      const applyRes = await Promise.race([claudeCall, applyTimeout]);
      const newHtml = applyRes.content[0].text.trim();

      // 3. Commit to GitHub
      const commitMsg = `AI: ${recommendation.slice(0, 80)}`;
      const putRes = await fetch(API, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          'User-Agent': 'ShotWithoutFear-Bot',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: commitMsg,
          content: Buffer.from(newHtml, 'utf-8').toString('base64'),
          sha: currentSha,
        }),
      });
      if (!putRes.ok) {
        const errText = await putRes.text();
        throw new Error(`GitHub commit failed: ${putRes.status} ${errText.slice(0, 200)}`);
      }

      // 4. Auto-log to change_log with metrics snapshot
      const siteData = await getSiteData();
      const today = new Date().toISOString().slice(0, 10);
      await supabase.from('change_log').insert({
        change_date: today,
        category: 'copy',
        title: recommendation.slice(0, 120),
        description: recommendation,
        hypothesis: reason || null,
        metrics_before: {
          visits: siteData.visits,
          ctas: siteData.ctas,
          purchases: siteData.purchases,
          ctr: siteData.ctr,
          sources: siteData.sources,
        },
      });

      return res.status(200).json({ ok: true, committed: commitMsg });
    }

    // ── Changes GET ──
    // ── Trend (30-day daily metrics + change markers) ──
    if (type === 'trend' && req.method === 'GET') {
      const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const [{ data: events }, { data: changeMarkers }] = await Promise.all([
        supabase.from('page_events').select('event_type, session_id, created_at').gte('created_at', since30),
        supabase.from('change_log').select('change_date, title, category').gte('change_date', since30.slice(0, 10)).order('change_date'),
      ]);
      const days = {};
      (events || []).forEach(e => {
        const day = e.created_at?.slice(0, 10);
        if (!day) return;
        if (!days[day]) days[day] = { visits: new Set(), ctas: 0, purchases: 0 };
        if (e.event_type === 'page_view') days[day].visits.add(e.session_id);
        if (e.event_type === 'cta_click') days[day].ctas++;
        if (e.event_type === 'purchase') days[day].purchases++;
      });
      const daily = Object.entries(days)
        .map(([date, d]) => ({
          date, visits: d.visits.size, ctas: d.ctas, purchases: d.purchases,
          ctr: d.visits.size ? Math.round(d.ctas / d.visits.size * 100) : 0,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
      return res.status(200).json({ ok: true, daily, changes: changeMarkers || [] });
    }

    if (type === 'changes' && req.method === 'GET') {
      const { data, error } = await supabase
        .from('change_log')
        .select('*')
        .order('change_date', { ascending: false })
        .limit(50);
      if (error) return res.status(200).json({ ok: false, error: error.message });
      // Compute verdicts for eligible changes (>7 days old, no verdict yet)
      const changes = data || [];
      try {
        const currentMetrics = await getSiteData();
        for (const c of changes) {
          if (c.verdict) continue;
          const v = computeVerdict(c, currentMetrics);
          if (!v) continue;
          await supabase.from('change_log').update({ ...v, verdict_at: new Date().toISOString().slice(0, 10) }).eq('id', c.id);
          Object.assign(c, v);
        }
      } catch(_) {}
      return res.status(200).json({ ok: true, changes });
    }

    // ── Changes POST ──
    if (type === 'changes' && req.method === 'POST') {
      const { change_date, category, title, description, hypothesis } = req.body;
      if (!title) return res.status(400).json({ ok: false, error: 'title required' });
      // Capture current site metrics as snapshot
      const siteData = await getSiteData();
      const metrics_before = {
        visits: siteData.visits,
        ctas: siteData.ctas,
        purchases: siteData.purchases,
        ctr: siteData.ctr,
        countries: siteData.countries,
        sources: siteData.sources,
      };
      const { error } = await supabase.from('change_log').insert({
        change_date: change_date || new Date().toISOString().slice(0, 10),
        category: category || 'other',
        title,
        description: description || null,
        hypothesis: hypothesis || null,
        metrics_before,
      });
      if (error) return res.status(200).json({ ok: false, error: error.message });
      return res.status(200).json({ ok: true });
    }

    // ── Persona GET ──
    if (type === 'persona' && req.method === 'GET') {
      const { data, error } = await supabase.from('persona').select('*').eq('id', 1).single();
      if (error) return res.status(200).json({ ok: true, persona: {} });
      return res.status(200).json({ ok: true, persona: data });
    }

    // ── Persona POST (save) ──
    if (type === 'persona' && req.method === 'POST') {
      const fields = req.body;
      const { error } = await supabase.from('persona').upsert(
        { id: 1, ...fields, updated_at: new Date().toISOString() },
        { onConflict: 'id' }
      );
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    // ── Site data fetch (step 1 of 2) ──
    if (type === 'site-data') {
      const pageFilter = req.query.page || null;
      const [siteData, persona, changes] = await Promise.all([getSiteData(pageFilter), fetchPersona(), fetchRecentChanges()]);
      return res.status(200).json({ ok: true, siteData, persona, changes });
    }

    // ── Site analyze (step 2 of 2) — receives pre-fetched data, calls Claude ──
    if (type === 'site-analyze' && req.method === 'POST') {
      const { siteData, persona, changes } = req.body || {};
      if (!siteData) return res.status(400).json({ ok: false, error: 'siteData required' });
      const analysis = await analyzeSiteWithClaude(siteData, persona || {}, changes || []);
      const today = new Date().toISOString().slice(0, 10);
      const { error: siteUpsertErr } = await supabase.from('ai_site_reports').upsert(
        { report_date: today, analysis },
        { onConflict: 'report_date' }
      );
      if (siteUpsertErr) console.error('ai_site_reports error:', JSON.stringify(siteUpsertErr));
      return res.status(200).json({ ok: true, date: today, analysis, saved: !siteUpsertErr });
    }

    if (req.method !== 'GET') return res.status(405).end();

    // ── Campaign + creative report (default) ──
    const [metaData, siteData, creatives, persona] = await Promise.all([
      fetchMetaInsights(), getSiteData(), fetchCreatives(), fetchPersona()
    ]);
    const analysis = await analyzeWithClaude(metaData, siteData, creatives, persona);
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase
      .from('ai_reports')
      .upsert({ report_date: today, meta_data: metaData, analysis: analysis.summary, recommendations: analysis }, { onConflict: 'report_date' });
    if (error) throw error;
    return res.status(200).json({ ok: true, date: today, analysis });

  } catch (err) {
    console.error('Daily report error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

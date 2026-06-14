const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

const ALL_HOOK_TYPES = ['medo', 'curiosidade', 'urgencia', 'autoridade', 'prova_social', 'beneficio'];
const ALL_ELEMENTS = [
  'pessoa', 'rosto_expressivo', 'seringa', 'produto', 'texto_sobreposto',
  'antes_depois', 'depoimento', 'numeros', 'cores_chamativas', 'fundo_simples',
  'cenario_medico', 'mao', 'corpo_inteiro', 'close_up',
];

const PROMPT_TEMPLATES = {
  editorial_saude: {
    label: 'Editorial Saúde',
    description: 'Estilo revista de saúde — limpo, empoderador, profissional',
    structure: 'A confident woman in her 50s, smiling, self-administering a small injection pen on her stomach, bright clean kitchen background, soft natural window light, shallow depth of field, shot on Canon 85mm f/1.8, health magazine editorial style, empowering, high resolution',
  },
  lifestyle_ugc: {
    label: 'Lifestyle Autêntico (UGC)',
    description: 'Estilo conteúdo real — casual, confiável, cotidiano',
    structure: 'Real woman 45-60 years old, casual home setting, holding injection pen confidently, relaxed expression, warm afternoon light, candid authentic moment, iPhone-style photo, relatable everyday scene, no makeup, trust-building',
  },
  antes_depois: {
    label: 'Antes/Depois Emocional',
    description: 'Composição dividida mostrando transformação de ansiedade para confiança',
    structure: 'Split composition: left side woman looking anxious holding syringe, right side same woman smiling confidently self-injecting, clean white background, clinical but warm, transformation story, health advertising style',
  },
  close_produto: {
    label: 'Close Produto + Mão',
    description: 'Foco no produto — elegante, premium, confiança no objeto',
    structure: 'Close-up of a woman\'s hand holding a GLP-1 injection pen, soft skin, manicured nails, clean medical aesthetic, macro lens, white marble background, premium health product photography, studio lighting',
  },
  depoimento_camera: {
    label: 'Depoimento / Câmera Direta',
    description: 'Mulher olhando direto para câmera — conexão, confiança, social proof',
    structure: 'Woman in her 50s looking directly at camera, warm genuine smile, holding injection pen casually, cozy living room background blurred, natural light, documentary portrait style, trustworthy, relatable, social media ad',
  },
  empoderamento: {
    label: 'Motivacional / Empoderamento',
    description: 'Estilo campanha aspiracional — força, confiança, superação',
    structure: 'Strong confident mature woman, arms relaxed, bright expression, wearing comfortable casual clothes, holding small medical pen, golden hour outdoor lighting, empowering health campaign, Nike-style composition, aspirational lifestyle',
  },
};

function score(ctr, cpc, impressions) {
  const confidence = Math.min(impressions / 1000, 1);
  const ctrScore = (ctr || 0) * 10;
  const cpcPenalty = (cpc || 0) * 2;
  return (ctrScore - cpcPenalty) * confidence;
}

async function loadCache() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/ai_suggestions?id=eq.latest&select=*`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const rows = await res.json();
  return rows.length > 0 ? rows[0] : null;
}

async function saveCache(suggestion, math) {
  await fetch(`${SUPABASE_URL}/rest/v1/ai_suggestions`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([{ id: 'latest', suggestion, math, created_at: new Date().toISOString() }]),
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const force = req.query.force === '1';

  try {
    // Return cached suggestion unless force=1
    if (!force) {
      const cached = await loadCache();
      if (cached) {
        return res.status(200).json({
          ok: true,
          cached: true,
          cached_at: cached.created_at,
          math: cached.math,
          suggestion: cached.suggestion,
        });
      }
    }

    // Fetch all analyzed creatives
    const sbRes = await fetch(
      `${SUPABASE_URL}/rest/v1/creatives?analyzed_at=not.is.null&select=*`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const creatives = await sbRes.json();

    if (!Array.isArray(creatives) || creatives.length === 0) {
      return res.status(200).json({ ok: false, error: 'Nenhum criativo analisado ainda. Rode a análise primeiro.' });
    }

    // ── MATH: rank hook types ──
    const hookStats = {};
    creatives.forEach(c => {
      const h = c.hook_type;
      if (!h) return;
      if (!hookStats[h]) hookStats[h] = { count: 0, ctrSum: 0, cpcSum: 0, imprSum: 0 };
      hookStats[h].count++;
      hookStats[h].ctrSum += c.ctr || 0;
      hookStats[h].cpcSum += c.cpc || 0;
      hookStats[h].imprSum += c.impressions || 0;
    });
    const hookRanked = Object.entries(hookStats)
      .map(([h, s]) => ({
        hook: h, count: s.count,
        avgCtr: s.ctrSum / s.count,
        avgCpc: s.cpcSum / s.count,
        score: score(s.ctrSum / s.count, s.cpcSum / s.count, s.imprSum / s.count),
      }))
      .sort((a, b) => b.score - a.score);

    const untestedHooks = ALL_HOOK_TYPES.filter(h => !hookStats[h]);

    // ── MATH: rank visual elements ──
    const elStats = {};
    creatives.forEach(c => {
      (c.visual_elements || []).forEach(el => {
        if (!elStats[el]) elStats[el] = { count: 0, ctrSum: 0, cpcSum: 0, imprSum: 0 };
        elStats[el].count++;
        elStats[el].ctrSum += c.ctr || 0;
        elStats[el].cpcSum += c.cpc || 0;
        elStats[el].imprSum += c.impressions || 0;
      });
    });
    const elRanked = Object.entries(elStats)
      .map(([el, s]) => ({
        element: el, count: s.count,
        avgCtr: s.ctrSum / s.count,
        avgCpc: s.cpcSum / s.count,
        score: score(s.ctrSum / s.count, s.cpcSum / s.count, s.imprSum / s.count),
      }))
      .sort((a, b) => b.score - a.score);

    const untestedElements = ALL_ELEMENTS.filter(el => !elStats[el]);

    // ── MATH: top creatives ──
    const topCreatives = [...creatives]
      .filter(c => c.impressions > 0)
      .sort((a, b) => score(b.ctr, b.cpc, b.impressions) - score(a.ctr, a.cpc, a.impressions))
      .slice(0, 3)
      .map(c => ({
        name: c.name, hook: c.hook, hook_type: c.hook_type,
        elements: c.visual_elements, tone: c.tone,
        ctr: c.ctr, cpc: c.cpc, impressions: c.impressions, notes: c.analysis_notes,
      }));

    const mathSummary = {
      total_creatives: creatives.length,
      hooks_ranked: hookRanked,
      elements_ranked: elRanked.slice(0, 10),
      untested_hooks: untestedHooks,
      untested_elements: untestedElements.slice(0, 6),
      top_creatives: topCreatives,
    };

    // ── MATH: rank templates ──
    const templateStats = {};
    creatives.forEach(c => {
      if (!c.template_used) return;
      if (!templateStats[c.template_used]) templateStats[c.template_used] = { count: 0, ctrSum: 0, cpcSum: 0, imprSum: 0 };
      templateStats[c.template_used].count++;
      templateStats[c.template_used].ctrSum += c.ctr || 0;
      templateStats[c.template_used].cpcSum += c.cpc || 0;
      templateStats[c.template_used].imprSum += c.impressions || 0;
    });
    const templateRanked = Object.entries(templateStats)
      .map(([t, s]) => ({
        template: t,
        label: PROMPT_TEMPLATES[t]?.label || t,
        count: s.count,
        avgCtr: s.ctrSum / s.count,
        score: score(s.ctrSum / s.count, s.cpcSum / s.count, s.imprSum / s.count),
      }))
      .sort((a, b) => b.score - a.score);

    const untestedTemplates = Object.keys(PROMPT_TEMPLATES).filter(t => !templateStats[t]);
    mathSummary.templates_ranked = templateRanked;
    mathSummary.untested_templates = untestedTemplates;

    const templatesBlock = Object.entries(PROMPT_TEMPLATES).map(([key, t]) => {
      const stats = templateStats[key];
      const perf = stats
        ? `CTR médio ${(stats.ctrSum/stats.count).toFixed(2)}% | score ${score(stats.ctrSum/stats.count, stats.cpcSum/stats.count, stats.imprSum/stats.count).toFixed(2)}`
        : 'ainda não testado';
      return `- ${key} (${t.label}): ${perf}\n  Estrutura base: "${t.structure}"`;
    }).join('\n');

    // ── CLAUDE: generate suggestions ──
    const prompt = `Você é um especialista em performance marketing e criação de anúncios para Meta Ads. Analise os dados de performance abaixo e gere sugestões de criativos usando os templates de prompt disponíveis.

## Produto
"Shot Without Fear" — ebook digital de $9 para usuários de GLP-1 (Ozempic, Mounjaro, Wegovy) que ensinam a aplicar injeções sem medo.
Público: EUA, 35-65 anos, maioria mulheres com dores relacionadas ao medo de injeção.

## Dados de Performance (${mathSummary.total_creatives} criativos analisados)

### Ranking de Hook Types por Score
${mathSummary.hooks_ranked.map(h => `- ${h.hook}: CTR ${h.avgCtr.toFixed(2)}% | CPC $${h.avgCpc.toFixed(2)} | ${h.count} criativos | score ${h.score.toFixed(2)}`).join('\n') || 'Sem dados suficientes'}

### Ranking de Elementos Visuais por Score
${mathSummary.elements_ranked.map(e => `- ${e.element}: CTR ${e.avgCtr.toFixed(2)}% | CPC $${e.avgCpc.toFixed(2)} | ${e.count} criativos | score ${e.score.toFixed(2)}`).join('\n') || 'Sem dados suficientes'}

### Top 3 Criativos
${mathSummary.top_creatives.map(c => `- "${c.hook}" (${c.hook_type}) | elementos: ${(c.elements||[]).join(', ')} | CTR ${c.ctr?.toFixed(2)}% | CPC $${c.cpc?.toFixed(2)}`).join('\n') || 'Sem dados'}

### Hooks Não Testados
${mathSummary.untested_hooks.length ? mathSummary.untested_hooks.join(', ') : 'Todos testados'}

### Elementos Não Testados
${mathSummary.untested_elements.length ? mathSummary.untested_elements.join(', ') : 'Todos testados'}

## Templates de Prompt Disponíveis (com performance histórica)
${templatesBlock}

## Sua Tarefa

1. Para o CAMPEÃO: escolha o template com melhor performance histórica (ou o mais adequado aos dados se não houver histórico). Adapte a estrutura base do template para o produto e hook escolhido, mantendo o estilo técnico do template (iluminação, câmera, composição).

2. Para o TESTE: escolha um template ainda não testado (ou o de menor score) para validar um novo estilo visual.

Responda em JSON exato:
{
  "champion": {
    "rationale": "Por que esta combinação deve ganhar — 2-3 frases baseadas nos dados",
    "template_used": "chave_do_template",
    "template_label": "Nome legível do template",
    "elements_used": ["elemento1", "elemento2"],
    "hook_type": "tipo_de_hook",
    "hook_text": "texto do hook sugerido para o anúncio",
    "image_prompt": "prompt final completo em inglês — estrutura do template adaptada para o produto e hook"
  },
  "test": {
    "rationale": "O que este teste vai validar e por que vale rodar — 2-3 frases",
    "hypothesis": "Hipótese: se [template/elemento não testado] então CTR vai [aumentar/diminuir] porque [razão]",
    "template_used": "chave_do_template",
    "template_label": "Nome legível do template",
    "elements_used": ["elemento1", "elemento2"],
    "hook_type": "tipo_de_hook",
    "hook_text": "texto do hook sugerido",
    "image_prompt": "prompt final completo em inglês — estrutura do template adaptada para o produto e hook"
  }
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Claude did not return valid JSON');
    const suggestion = JSON.parse(match[0]);

    // Save to cache
    await saveCache(suggestion, mathSummary);

    res.status(200).json({ ok: true, cached: false, math: mathSummary, suggestion });
  } catch (err) {
    console.error('suggest-creative error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

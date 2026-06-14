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

function score(ctr, cpc, impressions) {
  // Weighted score: CTR contributes positively, CPC negatively, impressions as confidence weight
  const confidence = Math.min(impressions / 1000, 1); // 0-1 based on volume
  const ctrScore = (ctr || 0) * 10;
  const cpcPenalty = (cpc || 0) * 2;
  return (ctrScore - cpcPenalty) * confidence;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  try {
    // Fetch all analyzed creatives with performance data
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
        hook: h,
        count: s.count,
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
        element: el,
        count: s.count,
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
        name: c.name,
        hook: c.hook,
        hook_type: c.hook_type,
        elements: c.visual_elements,
        tone: c.tone,
        ctr: c.ctr,
        cpc: c.cpc,
        impressions: c.impressions,
        notes: c.analysis_notes,
      }));

    const mathSummary = {
      total_creatives: creatives.length,
      hooks_ranked: hookRanked,
      elements_ranked: elRanked.slice(0, 10),
      untested_hooks: untestedHooks,
      untested_elements: untestedElements.slice(0, 6),
      top_creatives: topCreatives,
    };

    // ── CLAUDE: generate suggestions ──
    const prompt = `Você é um especialista em performance marketing e criação de anúncios para Meta Ads. Analise os dados matemáticos de performance abaixo e gere sugestões de criativos.

## Produto
"Shot Without Fear" — ebook digital de $9 para usuários de GLP-1 (Ozempic, Mounjaro, Wegovy) que ensinam a aplicar injeções sem medo.
Público: EUA, 35-65 anos, maioria mulheres com dores relacionadas ao medo de injeção.

## Dados de Performance (${mathSummary.total_creatives} criativos analisados)

### Ranking de Hook Types por Score (CTR vs CPC ponderado por volume)
${mathSummary.hooks_ranked.map(h => `- ${h.hook}: CTR ${h.avgCtr.toFixed(2)}% | CPC $${h.avgCpc.toFixed(2)} | ${h.count} criativos | score ${h.score.toFixed(2)}`).join('\n') || 'Sem dados suficientes'}

### Ranking de Elementos Visuais por Score
${mathSummary.elements_ranked.map(e => `- ${e.element}: CTR ${e.avgCtr.toFixed(2)}% | CPC $${e.avgCpc.toFixed(2)} | ${e.count} criativos | score ${e.score.toFixed(2)}`).join('\n') || 'Sem dados suficientes'}

### Top 3 Criativos
${mathSummary.top_creatives.map(c => `- "${c.hook}" (${c.hook_type}) | elementos: ${(c.elements||[]).join(', ')} | CTR ${c.ctr?.toFixed(2)}% | CPC $${c.cpc?.toFixed(2)}`).join('\n') || 'Sem dados'}

### Hooks Ainda Não Testados
${mathSummary.untested_hooks.length ? mathSummary.untested_hooks.join(', ') : 'Todos testados'}

### Elementos Ainda Não Testados
${mathSummary.untested_elements.length ? mathSummary.untested_elements.join(', ') : 'Todos testados'}

## Sua Tarefa

Gere dois outputs:

1. **PROMPT CAMPEÃO**: Combinando os elementos e hooks com melhor performance, crie um prompt detalhado para geração de imagem (Midjourney/DALL-E). O prompt deve descrever a imagem exata a ser criada.

2. **PROMPT TESTE**: Usando hooks ou elementos ainda não validados com maior potencial teórico para este produto/público, crie um prompt de imagem para um criativo de teste A/B.

Responda em JSON exato:
{
  "champion": {
    "rationale": "Por que esta combinação deve ganhar — 2-3 frases baseadas nos dados",
    "elements_used": ["elemento1", "elemento2"],
    "hook_type": "tipo_de_hook",
    "hook_text": "texto do hook sugerido para o anúncio",
    "image_prompt": "prompt completo em inglês para geração de imagem, muito detalhado, pronto para colar no Midjourney ou DALL-E"
  },
  "test": {
    "rationale": "O que este teste vai validar e por que vale rodar — 2-3 frases",
    "hypothesis": "Hipótese: se [elemento/hook não testado] então CTR/conversão vai [aumentar/diminuir] porque [razão]",
    "elements_used": ["elemento1", "elemento2"],
    "hook_type": "tipo_de_hook",
    "hook_text": "texto do hook sugerido",
    "image_prompt": "prompt completo em inglês para geração de imagem"
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

    res.status(200).json({ ok: true, math: mathSummary, suggestion });
  } catch (err) {
    console.error('suggest-creative error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

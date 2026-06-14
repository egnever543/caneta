const Anthropic = require('@anthropic-ai/sdk');

const CTA_OPTIONS = ['LEARN_MORE', 'SHOP_NOW', 'DOWNLOAD', 'GET_OFFER', 'SIGN_UP'];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.META_ACCESS_TOKEN;
  const rawId = process.env.META_AD_ACCOUNT_ID || '';
  const accountId = rawId.startsWith('act_') ? rawId : `act_${rawId}`;
  const base = 'https://graph.facebook.com/v19.0';

  const queryType = req.query.type || (req.method === 'POST' ? req.body?.type : null);

  try {
    // Generate ad copy via Claude
    if (queryType === 'ad-copy') {
      const { headline, hook_type, template_used } = req.method === 'POST' ? req.body : req.query;
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: `Você é copywriter especializado em anúncios de resposta direta para Meta Ads.

Produto: "Shot Without Fear" — ebook digital de $9 para usuários de GLP-1 (Ozempic, Mounjaro, Wegovy) que ensinam a aplicar injeções sem medo.
Público: EUA, 35-65 anos, maioria mulheres.

Headline do anúncio: "${headline}"
Tipo de hook: ${hook_type || 'não especificado'}
Estilo visual: ${template_used || 'não especificado'}

Gere o texto principal do anúncio (body) e indique o CTA mais adequado.

Regras para o body:
- Máximo 3 frases curtas
- Em inglês
- Empático, direto, sem exageros
- Menciona o preço $9 ou a facilidade/acessibilidade
- Termina com call to action implícito

CTA deve ser um de: ${CTA_OPTIONS.join(', ')}

Responda APENAS em JSON:
{
  "body": "texto principal do anúncio em inglês",
  "cta_type": "LEARN_MORE",
  "cta_reason": "motivo da escolha em 1 frase"
}`,
        }],
      });
      const text = response.content[0].text;
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Claude did not return valid JSON');
      const result = JSON.parse(match[0]);
      return res.status(200).json({ ok: true, ...result });
    }

    // Return adsets for a specific campaign
    if (queryType === 'adsets') {
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

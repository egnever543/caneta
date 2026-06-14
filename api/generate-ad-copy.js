const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CTA_OPTIONS = ['LEARN_MORE', 'SHOP_NOW', 'DOWNLOAD', 'GET_OFFER', 'SIGN_UP'];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const { headline, hook_type, template_used } = req.method === 'POST' ? req.body : req.query;

  try {
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

    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('generate-ad-copy error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

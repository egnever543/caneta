const META_FORMATS = [
  { key: 'feed',     label: 'Feed / Post',      aspectRatio: '1:1',  promptSuffix: 'square 1:1 format, perfectly centered composition' },
  { key: 'reels',    label: 'Reels / Stories',  aspectRatio: '9:16', promptSuffix: 'vertical 9:16 portrait format, tall composition, subject centered vertically' },
  { key: 'audience', label: 'Audience Network', aspectRatio: '16:9', promptSuffix: 'horizontal 16:9 widescreen landscape format, wide composition' },
];

async function generateOne(prompt, format, model, apiKey) {
  const fullPrompt = `${prompt}. ${format.promptSuffix}.`;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
      }),
    }
  );
  const json = await response.json();
  if (json.error) throw new Error(json.error.message);
  const parts = json.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
  if (!imagePart) throw new Error('Nenhuma imagem retornada');
  return { imageBase64: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { prompt, model = 'gemini-2.0-flash-exp', template_used = '' } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const apiKey = process.env.GOOGLE_AI_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GOOGLE_AI_KEY not configured' });

  try {
    // Generate all 3 formats in parallel
    const results = await Promise.allSettled(
      META_FORMATS.map(f => generateOne(prompt, f, model, apiKey))
    );

    const images = META_FORMATS.map((f, i) => {
      const r = results[i];
      if (r.status === 'fulfilled') {
        return { ...f, ok: true, imageBase64: r.value.imageBase64, mimeType: r.value.mimeType };
      }
      return { ...f, ok: false, error: r.reason?.message || 'Erro desconhecido' };
    });

    const anyOk = images.some(img => img.ok);
    res.status(200).json({ ok: anyOk, images, template_used });
  } catch (err) {
    console.error('generate-image error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

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

  // Generate ONE base image in 9:16 (Reels) — frontend crops to other formats
  // No text or overlays: headline is added via Canvas per format
  const fullPrompt = `${prompt}. Vertical 9:16 portrait format, tall composition, subject centered vertically, optimized for mobile Reels and Stories. NO text, NO captions, NO overlays, NO watermarks on the image — clean image only.`;

  try {
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

    res.status(200).json({
      ok: true,
      imageBase64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType,
      template_used,
    });
  } catch (err) {
    console.error('generate-image error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

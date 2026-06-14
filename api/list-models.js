module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const apiKey = process.env.GOOGLE_AI_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GOOGLE_AI_KEY not configured' });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`
  );
  const json = await response.json();

  // Filter to only image-generation capable models
  const imageModels = (json.models || []).filter(m =>
    m.name.includes('imagen') ||
    m.name.includes('image') ||
    (m.supportedGenerationMethods || []).includes('predict') ||
    (m.supportedGenerationMethods || []).includes('generateContent')
  );

  res.status(200).json({
    total: (json.models || []).length,
    image_related: imageModels.map(m => ({
      name: m.name,
      displayName: m.displayName,
      methods: m.supportedGenerationMethods,
    })),
    all_names: (json.models || []).map(m => m.name),
  });
};

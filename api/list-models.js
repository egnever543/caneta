module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const apiKey = process.env.GOOGLE_AI_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GOOGLE_AI_KEY not configured' });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`
  );
  const json = await response.json();

  const all = json.models || [];

  // Models that can generate content (images or text+images)
  const imageRelated = all.filter(m =>
    m.name.toLowerCase().includes('imagen') ||
    m.name.toLowerCase().includes('image') ||
    m.displayName?.toLowerCase().includes('image')
  );

  // All generateContent-capable models (potential image output via modalities)
  const generateContent = all.filter(m =>
    (m.supportedGenerationMethods || []).includes('generateContent')
  );

  res.status(200).json({
    total: all.length,
    image_related: imageRelated.map(m => ({
      name: m.name,
      displayName: m.displayName,
      methods: m.supportedGenerationMethods,
    })),
    generate_content_capable: generateContent.map(m => ({
      name: m.name,
      displayName: m.displayName,
    })),
    all_names: all.map(m => m.name),
  });
};

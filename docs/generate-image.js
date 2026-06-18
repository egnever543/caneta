// Detailed prompt builder for Shot Without Fear ad creatives.
// Follows structured prompt engineering: subject → emotion → setting → lighting → camera → post-processing.

const HOOK_CONFIGS = {
  medo: {
    emotion: 'transitioning from visible anxiety to determined confidence — eyebrows slightly raised, jaw set, eyes resolute',
    micro_expression: 'the exact moment fear gives way to courage, a subtle exhale visible',
    narrative: 'She has faced this moment a hundred times in her mind. Now she is ready.',
  },
  beneficio: {
    emotion: 'calm pride and quiet joy — soft genuine smile, relaxed shoulders, eyes warm and bright',
    micro_expression: 'the quiet satisfaction of someone who solved a hard problem on their own terms',
    narrative: 'This is what taking control of your own health feels like.',
  },
  curiosidade: {
    emotion: 'focused curiosity shading into pleasant discovery — head tilted slightly, eyes attentive',
    micro_expression: 'the look of someone reading something that finally makes perfect sense',
    narrative: 'She always wondered why it felt so hard. Now she understands.',
  },
  urgencia: {
    emotion: 'purposeful urgency, eyes sharp and direct, posture forward-leaning',
    micro_expression: 'decisive action, no hesitation, confident grip',
    narrative: 'No more delays. She knows exactly what to do.',
  },
  autoridade: {
    emotion: 'composed expert authority — measured, calm, trustworthy, direct gaze',
    micro_expression: 'the quiet certainty of someone who has done this many times',
    narrative: 'Mastery looks effortless when you have the right knowledge.',
  },
  prova_social: {
    emotion: 'warm accomplishment and gentle relatability — open expression, inviting energy',
    micro_expression: 'the pride of someone who just achieved something they thought they could not',
    narrative: 'She did it. And she wants you to know you can too.',
  },
};

const TEMPLATE_CONFIGS = {
  pessoa_injecao: {
    scene: 'a woman administering a GLP-1 self-injection (pen injector) into her abdomen or thigh',
    props: 'modern GLP-1 auto-injector pen (generic, no brand markings), held with confident practiced grip',
    setting: 'clean bright home environment — kitchen counter or bathroom vanity, soft natural light from a window',
    wardrobe: 'casual everyday clothing — fitted t-shirt or light blouse, conveying normalcy not clinical sterility',
  },
  antes_depois: {
    scene: 'a woman looking at herself in a mirror with quiet self-recognition, hands relaxed at sides',
    props: 'clean mirror reflection, possibly a GLP-1 pen on the counter beside her',
    setting: 'bright modern bathroom, clean white surfaces, warm natural lighting from above',
    wardrobe: 'comfortable everyday clothes, hair down, natural makeup or none',
  },
  produto_destaque: {
    scene: 'a GLP-1 auto-injector pen held in the center of the frame by a woman\'s hand, sharp focus on pen',
    props: 'generic GLP-1 injector pen, no brand markings, modern ergonomic design',
    setting: 'neutral soft background — white or light gray surface, minimal clutter',
    wardrobe: 'only hands visible, clean natural nails, no jewelry',
  },
  lifestyle: {
    scene: 'a confident woman in an everyday moment — morning routine, healthy breakfast, light activity',
    props: 'subtle — a glass of water, a small notebook, natural surroundings',
    setting: 'bright airy home interior, large windows, plants, warm lifestyle photography aesthetic',
    wardrobe: 'casual modern clothing, relaxed fit, neutral or soft earth tones',
  },
  close_rosto: {
    scene: 'tight portrait close-up of a woman\'s face, expression carrying the full emotional weight of the hook',
    props: 'none — pure portrait, face fills the frame',
    setting: 'clean neutral background with very shallow depth of field, all attention on the face',
    wardrobe: 'shoulder/neckline of a simple top visible at bottom of frame',
  },
};

function buildDetailedPrompt(userHint, hookType, templateKey) {
  const hook = HOOK_CONFIGS[hookType] || HOOK_CONFIGS.beneficio;
  const tmpl = TEMPLATE_CONFIGS[templateKey] || TEMPLATE_CONFIGS.pessoa_injecao;

  return `
SUBJECT:
A real American woman, 42 to 58 years old, relatable everyday appearance.
Build: average to slightly full-figured, not model-thin — authentically representing the GLP-1 user demographic.
Ethnicity: Caucasian, Hispanic, or mixed — warm skin tones.
Hair: natural, shoulder-length or shorter, realistic styling (not glamour).
Expression: ${hook.emotion}.
Micro-expression detail: ${hook.micro_expression}.
Scene narrative: ${hook.narrative}

SCENE & ACTION:
${tmpl.scene}.
Props: ${tmpl.props}.
Setting: ${tmpl.setting}.
Wardrobe: ${tmpl.wardrobe}.
${userHint ? `Additional creative direction: ${userHint}.` : ''}

COMPOSITION:
Vertical 9:16 portrait format, optimized for mobile Reels and Stories.
Subject fills approximately 65 to 80 percent of the vertical frame.
Subject centered horizontally, positioned slightly above center vertically.
Foreground dominant with shallow depth of field.
Camera angle: eye-level to very slight low angle (empowering perspective).
Simulated 85mm portrait lens at f/1.8 — sharp on subject eyes, background softly blurred.

LIGHTING:
Key light: soft diffused natural window light from the left, warm 4800K, casting gentle shadows.
Fill light: subtle bounce from white wall or surface on the right, very soft.
Rim light: thin warm highlight on hair edge, separating subject from background.
Overall feel: clean, warm, inviting — editorial lifestyle photography, not medical or clinical.

COLOR PALETTE:
Dominant tones: warm whites, soft creams, gentle sage greens, muted terracotta.
Shadows: warm dark browns, never cold blue-black.
Color grade: natural film-like warmth, slight lifted shadows, soft highlight rolloff.
Saturation: natural, slightly muted — real-life not oversaturated.
Skin tones: accurate, warm subsurface scattering, pore-level realism, subtle natural glow.

POST-PROCESSING STYLE:
Photorealistic editorial photography aesthetic.
High detail on subject face and hands — pores, fine lines, natural skin texture.
Cinematic but not dramatic — warm editorial magazine quality.
Background: soft gaussian bokeh, shapes and colors abstract, no readable text in background.
Subtle vignette at corners drawing eye to subject.
Natural grain — clean image, not noise-heavy.

TECHNICAL QUALITY MODIFIERS:
8K photorealistic, hyperrealistic portrait photography, Canon EOS R5 or Sony A7R V quality,
natural light lifestyle photography, award-winning editorial photography, sharp subject focus,
professional color grading, subsurface skin scattering, authentic human emotion captured.

STRICT RESTRICTIONS — NEVER INCLUDE:
NO text, words, letters, captions, labels, watermarks, or logos anywhere on the image.
NO overlays or graphic design elements.
NO cartoon, illustration, painting, or anime aesthetics.
NO medical sterility (no blue hospital lighting, no clinical white coats, no exam rooms).
NO brand names or logos on any products.
NO extra limbs, deformed hands, or anatomical errors.
NO overly glamorous or model-perfect appearance — must look like a real everyday person.
NO fear-inducing imagery — the tone is empowerment, confidence, and ease.
`.trim();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const {
    prompt,
    hook_type = 'beneficio',
    template_used = 'pessoa_injecao',
    model = 'gemini-2.0-flash-exp',
  } = req.body;

  const apiKey = process.env.GOOGLE_AI_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GOOGLE_AI_KEY not configured' });

  const fullPrompt = buildDetailedPrompt(prompt, hook_type, template_used);

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
      prompt_used: fullPrompt,
    });
  } catch (err) {
    console.error('generate-image error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

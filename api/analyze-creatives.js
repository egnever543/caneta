const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

async function sbUpsert(data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/creatives`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(Array.isArray(data) ? data : [data]),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase upsert failed: ${res.status} ${text}`);
  }
  return true;
}

async function sbSelect(id) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/creatives?id=eq.${id}&select=id,analyzed_at,image_url_override`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  return res.json();
}

async function fetchImageBase64(url, token) {
  let fetchUrl = url;
  try {
    const parsed = new URL(url);
    const inner = parsed.searchParams.get('url');
    if (inner) fetchUrl = decodeURIComponent(inner);
  } catch(_) {}

  // Append access token if it's a facebook.com URL (requires auth)
  if (token && fetchUrl.includes('facebook.com') && !fetchUrl.includes('access_token')) {
    fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + `access_token=${token}`;
  }

  const res = await fetch(fetchUrl);
  if (!res.ok) throw new Error(`Image fetch failed: ${res.status} ${fetchUrl}`);
  const buffer = await res.arrayBuffer();
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const mediaType = contentType.split(';')[0].trim();
  return { base64: Buffer.from(buffer).toString('base64'), mediaType };
}

async function analyzeWithClaude(base64, mediaType) {
  const prompt = `Você é um especialista em marketing direto e análise de criativos para Meta Ads. Analise este anúncio do produto "Shot Without Fear" — ebook de $9 para usuários de GLP-1 (Ozempic, Mounjaro, Wegovy) que ensinam a aplicar injeções sem medo. Público: EUA, 35-65 anos, maioria mulheres.

Analise a imagem e responda APENAS com JSON válido, sem texto adicional:
{
  "hook": "texto exato do hook principal ou descrição se for visual",
  "hook_type": "medo|curiosidade|urgencia|autoridade|prova_social|beneficio",
  "hook_score": 7,
  "visual_elements": ["lista", "de", "elementos", "visuais", "presentes"],
  "dominant_colors": ["cor1", "cor2"],
  "has_person": true,
  "has_product": false,
  "has_text_overlay": true,
  "cta_text": "texto do CTA se visível ou null",
  "tone": "urgente|educativo|emocional|direto|empático",
  "target_audience": "descrição do público aparente",
  "analysis_notes": "2-3 frases sobre pontos fortes, fracos e o que provavelmente funciona ou não"
}

Elementos visuais possíveis: pessoa, rosto_expressivo, seringa, produto, texto_sobreposto, antes_depois, depoimento, numeros, cores_chamativas, fundo_simples, cenario_medico, mao, corpo_inteiro, close_up.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: prompt },
      ],
    }],
  });

  const text = response.content[0].text;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude did not return valid JSON');
  return JSON.parse(match[0]);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const token = process.env.META_ACCESS_TOKEN;
  const rawId = process.env.META_AD_ACCOUNT_ID || '';
  const accountId = rawId.startsWith('act_') ? rawId : `act_${rawId}`;
  const base = 'https://graph.facebook.com/v19.0';
  const forceReanalyze = req.query.force === '1';
  const singleCreativeId = req.query.creative_id || null;
  const debugMode = req.query.debug === '1';

  try {
    // Debug mode: return raw fields from Meta for a specific creative
    if (debugMode && singleCreativeId) {
      const r = await fetch(`${base}/${singleCreativeId}?fields=image_hash,image_url,thumbnail_url,object_story_spec,effective_object_story_id&access_token=${token}`);
      const raw = await r.json();
      const hash = raw.image_hash || raw.object_story_spec?.link_data?.image_hash;
      let adimagesResult = null;
      if (hash) {
        const ir = await fetch(`${base}/${accountId}/adimages?hashes=["${hash}"]&fields=url,url_128,width,height&access_token=${token}`);
        adimagesResult = await ir.json();
      }
      let postResult = null;
      if (raw.effective_object_story_id) {
        const pr = await fetch(`${base}/${raw.effective_object_story_id}?fields=full_picture,picture&access_token=${token}`);
        postResult = await pr.json();
      }
      // Show thumbnail URL with stp removed (full-res fallback)
      let thumbnailFullRes = null;
      if (raw.thumbnail_url) {
        try {
          const tp = new URL(raw.thumbnail_url);
          tp.searchParams.delete('stp');
          thumbnailFullRes = tp.toString();
        } catch(_) {}
      }
      return res.status(200).json({ raw, adimagesResult, postResult, thumbnailFullRes });
    }
    const filterParam = singleCreativeId ? '' : `&filtering=[{"field":"campaign.effective_status","operator":"IN","value":["ACTIVE"]}]`;
    const [adsRes, insightsRes] = await Promise.all([
      fetch(`${base}/${accountId}/ads?fields=id,name,adset_id,campaign_id,status,creative{id,name,image_url,thumbnail_url,object_story_spec}${filterParam}&limit=100&access_token=${token}`),
      fetch(`${base}/${accountId}/insights?fields=ad_id,impressions,clicks,spend,ctr,cpc,reach,frequency&date_preset=last_30d&level=ad&limit=100&access_token=${token}`),
    ]);

    const [adsJson, insightsJson] = await Promise.all([adsRes.json(), insightsRes.json()]);
    if (adsJson.error) return res.status(200).json({ ok: false, error: adsJson.error.message });

    const insightMap = {};
    (insightsJson.data || []).forEach(i => { insightMap[i.ad_id] = i; });

    const ads = adsJson.data || [];
    const results = [];

    for (const ad of ads) {
      const creative = ad.creative;
      if (!creative) continue;
      if (singleCreativeId && creative.id !== singleCreativeId) continue;

      let imageUrl = null;
      const thumbnailUrl = creative.thumbnail_url || null;

      try {
        // Fetch all image-related fields directly from the creative endpoint
        const creativeRes = await fetch(
          `${base}/${creative.id}?fields=image_hash,image_url,thumbnail_url,object_story_spec,effective_object_story_id&access_token=${token}`
        );
        const c = await creativeRes.json();
        console.log(`Creative ${creative.id} raw fields:`, JSON.stringify({
          image_hash: c.image_hash,
          image_url: c.image_url?.slice(0, 80),
          oss_picture: c.object_story_spec?.link_data?.picture?.slice(0, 80),
          oss_image_hash: c.object_story_spec?.link_data?.image_hash,
        }));

        // 1. object_story_spec.link_data.picture — direct image URL in the ad spec
        const picture = c.object_story_spec?.link_data?.picture
          || c.object_story_spec?.video_data?.image_url;

        // 2. Resolve via image_hash → adimages endpoint
        const hash = c.image_hash
          || c.object_story_spec?.link_data?.image_hash;

        let hashUrl = null;
        if (hash) {
          const imgRes = await fetch(
            `${base}/${accountId}/adimages?hashes=["${hash}"]&fields=url,url_128,width,height&access_token=${token}`
          );
          const imgJson = await imgRes.json();
          const img = imgJson.data?.[0];
          console.log(`Creative ${creative.id} adimages result:`, JSON.stringify(img));
          if (img?.url && !img.url.includes('p64x64') && !img.url.includes('p128x128')) {
            hashUrl = img.url;
          } else if (img?.url_128) {
            hashUrl = img.url_128;
          }
        }

        // 3. Fetch full_picture from the Facebook post via effective_object_story_id
        let postPicture = null;
        const postId = c.effective_object_story_id;
        if (!picture && !hashUrl && postId) {
          const postRes = await fetch(
            `${base}/${postId}?fields=full_picture&access_token=${token}`
          );
          const postJson = await postRes.json();
          console.log(`Creative ${creative.id} post full_picture:`, postJson.full_picture?.slice(0, 80));
          if (postJson.full_picture) postPicture = postJson.full_picture;
        }

        // Priority: picture from story spec > hash URL > post full_picture > image_url > thumbnail
        imageUrl = picture || hashUrl || postPicture || c.image_url || thumbnailUrl;
      } catch(e) {
        console.error(`Creative ${creative.id} image resolve error:`, e.message);
        imageUrl = thumbnailUrl;
      }

      // Check if already analyzed (also fetches image_url_override)
      const existing = await sbSelect(creative.id);
      const alreadyAnalyzed = existing.length > 0 && existing[0].analyzed_at;

      // Override with manually uploaded image if available
      if (existing[0]?.image_url_override) imageUrl = existing[0].image_url_override;

      if (!imageUrl) { results.push({ id: creative.id, skipped: 'no_image' }); continue; }
      console.log(`Creative ${creative.id} — image URL: ${imageUrl}`);

      let analysis = null;
      if (forceReanalyze || !alreadyAnalyzed) {
        try {
          const { base64, mediaType } = await fetchImageBase64(imageUrl, token);
          analysis = await analyzeWithClaude(base64, mediaType);
        } catch (e) {
          console.error(`Creative ${creative.id} analysis failed:`, e.message);
          results.push({ id: creative.id, error: e.message });
        }
      }

      const insight = insightMap[ad.id] || {};
      const record = {
        id: creative.id,
        ad_id: ad.id,
        adset_id: ad.adset_id,
        campaign_id: ad.campaign_id,
        name: creative.name || ad.name,
        thumbnail_url: thumbnailUrl,
        media_type: 'image',
        impressions: parseInt(insight.impressions || 0),
        clicks: parseInt(insight.clicks || 0),
        spend: parseFloat(insight.spend || 0),
        ctr: parseFloat(insight.ctr || 0),
        cpc: parseFloat(insight.cpc || 0),
        reach: parseInt(insight.reach || 0),
        frequency: parseFloat(insight.frequency || 0),
        updated_at: new Date().toISOString(),
        ...(analysis ? {
          hook: analysis.hook,
          hook_type: analysis.hook_type,
          hook_score: analysis.hook_score,
          visual_elements: analysis.visual_elements,
          dominant_colors: analysis.dominant_colors,
          has_person: analysis.has_person,
          has_product: analysis.has_product,
          has_text_overlay: analysis.has_text_overlay,
          cta_text: analysis.cta_text,
          tone: analysis.tone,
          target_audience: analysis.target_audience,
          analysis_notes: analysis.analysis_notes,
          analysis_raw: analysis,
          analyzed_at: new Date().toISOString(),
        } : {}),
      };

      await sbUpsert(record);
      if (!results.find(r => r.id === creative.id)) {
        results.push({ id: creative.id, name: record.name, analyzed: !!analysis });
      }
    }

    res.status(200).json({ ok: true, total: ads.length, processed: results.length, results });
  } catch (err) {
    console.error('analyze-creatives error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

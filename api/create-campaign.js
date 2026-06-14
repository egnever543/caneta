const base = 'https://graph.facebook.com/v19.0';

async function uploadImage(accountId, base64, mimeType, filename, token) {
  const params = new URLSearchParams();
  params.append('bytes', base64);
  params.append('access_token', token);
  const res = await fetch(`${base}/${accountId}/adimages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const json = await res.json();
  if (json.error) throw new Error(`Image upload failed: ${json.error.message}`);
  const images = json.images || {};
  const first = Object.values(images)[0];
  if (!first?.hash) throw new Error('No image hash returned from Meta');
  return first.hash;
}

async function metaPost(path, payload, token) {
  const res = await fetch(`${base}/${path}?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (json.error) {
    const detail = json.error.error_user_msg || json.error.error_data || '';
    throw new Error(`${json.error.message}${detail ? ` — ${detail}` : ''} [code ${json.error.code}] payload: ${JSON.stringify(payload)}`);
  }
  return json;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const token = process.env.META_ACCESS_TOKEN;
  const rawId = process.env.META_AD_ACCOUNT_ID || '';
  const accountId = rawId.startsWith('act_') ? rawId : `act_${rawId}`;

  const {
    mode,           // 'new' | 'existing'
    images,         // { feed: {base64, mimeType}, reels: {...}, audience: {...} }
    page_id,
    pixel_id,
    headline,
    body,
    destination_url,
    cta_type = 'LEARN_MORE',
    // mode=new fields:
    campaign_name,
    objective = 'OUTCOME_SALES',
    daily_budget,   // in cents (R$ * 100)
    start_time,
    end_time,
    countries = ['US'],
    age_min = 35,
    age_max = 65,
    genders,        // [] = all, [1] = male, [2] = female
    ad_status = 'PAUSED', // 'PAUSED' | 'ACTIVE'
    // mode=existing fields:
    adset_id,
  } = req.body;

  try {
    const log = [];

    // ── 1. Upload images ──
    log.push('Fazendo upload das imagens...');
    const formatDefs = [
      { key: 'feed',     label: 'Feed 1:1'   },
      { key: 'reels',    label: 'Reels 9:16' },
      { key: 'audience', label: 'Audience 16:9' },
    ];

    const imageHashes = {};
    await Promise.all(formatDefs.map(async f => {
      const img = images?.[f.key];
      if (!img?.base64) return;
      imageHashes[f.key] = await uploadImage(accountId, img.base64, img.mimeType, `${f.key}.jpg`, token);
    }));
    log.push(`Imagens enviadas: ${Object.keys(imageHashes).join(', ')}`);

    // ── 2. Create campaign (mode=new only) ──
    let finalCampaignId;
    let finalAdsetId = adset_id;

    if (mode === 'new') {
      log.push('Criando campanha...');
      const camp = await metaPost(`${accountId}/campaigns`, {
        name: campaign_name || `SWF — ${headline?.slice(0, 40)}`,
        objective,
        status: 'PAUSED',
        special_ad_categories: [],
      }, token);
      finalCampaignId = camp.id;
      log.push(`Campanha criada: ${finalCampaignId}`);

      // ── 3. Create adset ──
      log.push('Criando ad set...');
      // daily_budget comes as float (e.g. 10.00 USD) — Meta expects cents (integer)
      const budgetCents = Math.round(parseFloat(daily_budget) * 100);

      // start_time from HTML date input is "YYYY-MM-DD" — convert to ISO timestamp
      const startTs = start_time
        ? new Date(start_time + 'T00:00:00Z').toISOString()
        : new Date().toISOString();
      const endTs = end_time
        ? new Date(end_time + 'T23:59:59Z').toISOString()
        : null;

      const adsetPayload = {
        name: `${campaign_name || 'SWF'} — Ad Set`,
        campaign_id: finalCampaignId,
        daily_budget: budgetCents,
        billing_event: 'IMPRESSIONS',
        optimization_goal: pixel_id ? 'OFFSITE_CONVERSIONS' : 'LINK_CLICKS',
        targeting: {
          geo_locations: { countries: Array.isArray(countries) ? countries : [countries] },
          age_min: parseInt(age_min) || 35,
          age_max: parseInt(age_max) || 65,
          ...(Array.isArray(genders) && genders.length ? { genders } : {}),
        },
        start_time: startTs,
        status: 'PAUSED',
      };
      if (endTs) adsetPayload.end_time = endTs;
      if (pixel_id) {
        adsetPayload.promoted_object = { pixel_id, custom_event_type: 'PURCHASE' };
      }
      const adset = await metaPost(`${accountId}/adsets`, adsetPayload, token);
      finalAdsetId = adset.id;
      log.push(`Ad Set criado: ${finalAdsetId}`);
    }

    // ── 4. Create ONE creative — use reels (9:16) as primary, fallback to feed ──
    const primaryHash = imageHashes.reels || imageHashes.feed || Object.values(imageHashes)[0];
    if (!primaryHash) throw new Error('Nenhuma imagem disponível para criar o creative');

    log.push('Criando creative...');
    const creative = await metaPost(`${accountId}/adcreatives`, {
      name: `SWF — ${headline?.slice(0, 40)}`,
      object_story_spec: {
        page_id,
        link_data: {
          image_hash: primaryHash,
          link: destination_url,
          message: body,
          name: headline,
          call_to_action: { type: cta_type, value: { link: destination_url } },
        },
      },
    }, token);
    log.push(`Creative criado: ${creative.id}`);

    // ── 5. Create ONE ad referencing the creative ──
    log.push('Criando anúncio...');
    const ad = await metaPost(`${accountId}/ads`, {
      name: `SWF — ${headline?.slice(0, 40)}`,
      adset_id: finalAdsetId,
      creative: { creative_id: creative.id },
      status: ad_status,
    }, token);
    const createdAds = [{ ad_id: ad.id, creative_id: creative.id }];

    log.push(`Anúncio criado como ${ad_status}.`);

    res.status(200).json({
      ok: true,
      campaign_id: finalCampaignId || null,
      adset_id: finalAdsetId,
      ads: createdAds,
      log,
      meta_url: finalCampaignId
        ? `https://business.facebook.com/adsmanager/manage/campaigns?act=${rawId}&selected_campaign_ids=${finalCampaignId}`
        : `https://business.facebook.com/adsmanager/manage/adsets?act=${rawId}`,
    });
  } catch (err) {
    console.error('create-campaign error:', err.message);
    res.status(200).json({ ok: false, error: err.message });
  }
};

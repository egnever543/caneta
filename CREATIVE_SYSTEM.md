# Sistema de Análise e Sugestão de Criativos

Documento técnico para referência em futuras conversas com IA.
Descreve a lógica completa do pipeline de análise de criativos da conta Meta Ads.

---

## Visão Geral do Pipeline

```
Meta Ads API
    └── ads ativos (apenas campanhas ACTIVE)
            └── imagem full-res de cada criativo
                    └── Claude Vision (análise)
                            └── Supabase tabela `creatives`
                                    └── Matemática de score
                                            └── Claude Sonnet (sugestão)
                                                    └── Dashboard (Prompt Campeão + Prompt Teste)
```

---

## Arquivos Envolvidos

| Arquivo | Função |
|---|---|
| `api/analyze-creatives.js` | Busca criativos na Meta, analisa imagens com Claude Vision, salva no Supabase |
| `api/suggest-creative.js` | Lê dados do Supabase, calcula scores, pede sugestão ao Claude Sonnet |
| `dashboard.html` | Exibe cards de criativos, ranking de elementos, sugestões com prompts |

---

## Etapa 1 — Análise de Imagem (`analyze-creatives.js`)

### O que faz
Busca todos os ads de **campanhas ACTIVE** na Meta API, baixa a imagem de cada criativo e envia para o Claude Vision extrair os elementos.

### Filtro de campanhas ativas
```js
// O filtro é aplicado direto na query da Meta API
fetch(`/ads?filtering=[{"field":"campaign.effective_status","operator":"IN","value":["ACTIVE"]}]`)
```
Só criativos de campanhas com status ACTIVE são processados. Campanhas pausadas ou encerradas são ignoradas.

### Busca da imagem em alta qualidade
```js
// Primeiro tenta image_url (full-res)
let imageUrl = creative.image_url;

// Se não vier, busca direto no endpoint do criativo
if (!imageUrl) {
  const creativeRes = await fetch(`/{creative.id}?fields=image_url,thumbnail_url`);
  imageUrl = creativeJson.image_url || creativeJson.thumbnail_url;
}

// thumbnail_url é salvo separado — usado só para exibição no dashboard
const thumbnailUrl = creative.thumbnail_url || imageUrl;
```
**Por que isso importa:** `thumbnail_url` é baixa resolução (preview). Para a IA analisar bem os elementos visuais, precisa da imagem original (`image_url`). O thumbnail fica só para exibir no card do dashboard.

### Lógica de re-análise
```js
const existing = await sbSelect(creative.id);
const alreadyAnalyzed = existing.length > 0 && existing[0].analyzed_at;

// Só analisa se ainda não foi analisado
if (forceReanalyze || !alreadyAnalyzed) {
  const { base64, mediaType } = await fetchImageBase64(imageUrl);
  analysis = await analyzeWithClaude(base64, mediaType);
}
// Se já foi analisado, apenas atualiza métricas de performance (CTR, CPC, etc.)
```
- Chamada normal: só analisa criativos **novos** (sem `analyzed_at` no banco)
- `?force=1` na URL: re-analisa todos, mesmo os já processados
- Métricas de performance são **sempre** atualizadas, independente de re-análise

### O que o Claude Vision extrai
O prompt instrui o Claude a retornar este JSON:
```json
{
  "hook": "texto exato ou descrição do hook principal",
  "hook_type": "medo|curiosidade|urgencia|autoridade|prova_social|beneficio",
  "hook_score": 8,
  "visual_elements": ["pessoa", "seringa", "texto_sobreposto"],
  "dominant_colors": ["vermelho", "branco"],
  "has_person": true,
  "has_product": false,
  "has_text_overlay": true,
  "cta_text": "texto do botão ou null",
  "tone": "urgente|educativo|emocional|direto|empático",
  "target_audience": "descrição do público aparente",
  "analysis_notes": "pontos fortes e fracos em 2-3 frases"
}
```

### Upsert no Supabase
```js
// Prefer: resolution=merge-duplicates → INSERT se não existe, UPDATE se já existe (pelo id)
// Prefer: return=minimal → Supabase retorna 204 (sem body). SEM isso, res.json() quebraria.
headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }
```
**Ponto de atenção:** o Supabase retorna `204 No Content` quando `return=minimal` está ativo. Se tentar fazer `res.json()` numa resposta vazia, o Node lança `"Unexpected end of JSON input"`. Por isso a função `sbUpsert` verifica `res.ok` antes e nunca chama `.json()`.

---

## Etapa 2 — Sistema de Score (`suggest-creative.js`)

### Fórmula do Score
```js
function score(ctr, cpc, impressions) {
  const confidence = Math.min(impressions / 1000, 1); // fator 0 a 1
  const ctrScore   = (ctr || 0) * 10;                 // CTR beneficia
  const cpcPenalty = (cpc || 0) * 2;                  // CPC penaliza
  return (ctrScore - cpcPenalty) * confidence;
}
```

**Por que cada parte existe:**

| Componente | Lógica |
|---|---|
| `ctr * 10` | CTR alto = criativo atraente. Multiplica por 10 para dar peso relevante |
| `cpc * 2` | CPC alto = caro para trazer clique. Penaliza, mas menos que o CTR beneficia |
| `confidence` | Criativo com 50 impressões pode ter CTR alto por acaso. Com 1000+ impressões, o dado é confiável (peso = 1.0) |

**Exemplo prático:**
```
Criativo A: CTR 3%, CPC R$1.20, 2000 impressões
  confidence = min(2000/1000, 1) = 1.0
  score = (3*10 - 1.20*2) * 1.0 = (30 - 2.4) = 27.6

Criativo B: CTR 8%, CPC R$0.80, 80 impressões (pouco volume)
  confidence = min(80/1000, 1) = 0.08
  score = (8*10 - 0.80*2) * 0.08 = (80 - 1.6) * 0.08 = 6.3

→ Criativo A vence apesar do CTR menor, porque tem volume suficiente para confiar nos dados.
```

### Agrupamento por Hook Type
```js
// Agrupa todos os criativos que usam o mesmo hook_type
const hookStats = {};
creatives.forEach(c => {
  if (!hookStats[c.hook_type]) hookStats[c.hook_type] = { count: 0, ctrSum: 0, cpcSum: 0, imprSum: 0 };
  hookStats[c.hook_type].count++;
  hookStats[c.hook_type].ctrSum += c.ctr || 0;
  // ...
});

// Calcula médias e aplica a fórmula de score
const hookRanked = Object.entries(hookStats).map(([h, s]) => ({
  avgCtr: s.ctrSum / s.count,   // média de CTR de todos os criativos com esse hook
  avgCpc: s.cpcSum / s.count,
  score: score(s.ctrSum / s.count, s.cpcSum / s.count, s.imprSum / s.count),
})).sort((a, b) => b.score - a.score);
```

### Agrupamento por Elemento Visual
Igual ao de hooks, mas um criativo pode contribuir para **múltiplos elementos**:
```js
creatives.forEach(c => {
  (c.visual_elements || []).forEach(el => {
    // Cada elemento do array visual_elements é contado separadamente
    elStats[el].ctrSum += c.ctr;  // CTR do criativo inteiro é atribuído a cada elemento
  });
});
```
**Limitação importante:** se um criativo tem `["pessoa", "seringa", "texto_sobreposto"]` e CTR de 4%, todos os três elementos recebem esse CTR. Não é possível isolar qual elemento especificamente causou o CTR alto — apenas que eles **coexistem** com bom resultado.

### Identificação de Gaps (não testados)
```js
const ALL_HOOK_TYPES = ['medo', 'curiosidade', 'urgencia', 'autoridade', 'prova_social', 'beneficio'];
const ALL_ELEMENTS   = ['pessoa', 'rosto_expressivo', 'seringa', 'produto', ...];

// O que está no universo mas não apareceu em nenhum criativo analisado
const untestedHooks    = ALL_HOOK_TYPES.filter(h  => !hookStats[h]);
const untestedElements = ALL_ELEMENTS.filter(el => !elStats[el]);
```
Esses arrays definem o **universo possível**. Se você quiser adicionar novos tipos de hook ou elementos no futuro, basta incluir nas constantes no topo do arquivo.

### O que o Claude recebe
A IA **não faz matemática** — recebe um resumo já calculado em texto:
```
- medo: CTR 3.20% | CPC R$1.20 | 4 criativos | score 27.60
- curiosidade: CTR 1.10% | CPC R$2.80 | 2 criativos | score 4.40
- Não testados: autoridade, prova_social
```
O Claude usa esses dados para redigir a justificativa e gerar os prompts de imagem em inglês (para Midjourney/DALL-E).

---

## Tabela `creatives` no Supabase

```sql
CREATE TABLE creatives (
  id TEXT PRIMARY KEY,       -- ID do criativo na Meta (nunca muda)
  ad_id TEXT,
  campaign_id TEXT,
  thumbnail_url TEXT,        -- baixa resolução, só para exibição
  media_type TEXT DEFAULT 'image',  -- 'image' | 'video' (futuro)

  -- Análise da IA (preenchido pelo analyze-creatives.js)
  hook TEXT,
  hook_type TEXT,
  hook_score INTEGER,        -- 1-10
  visual_elements JSONB,     -- array: ["pessoa", "seringa"]
  tone TEXT,
  analysis_notes TEXT,
  analyzed_at TIMESTAMPTZ,   -- NULL = ainda não analisado

  -- Performance Meta (atualizado pelo cron diário)
  impressions INTEGER,
  clicks INTEGER,
  spend NUMERIC,
  ctr NUMERIC,
  cpc NUMERIC,
  reach INTEGER,
  frequency NUMERIC,

  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Campo `analyzed_at`:** é a chave de controle. NULL = não analisado. Preenchido = skip na próxima rodada (só atualiza métricas).

---

## Crons Automáticos (vercel.json)

```json
{ "path": "/api/daily-report",       "schedule": "0 11 * * *" }  // 11h: relatório IA de campanhas
{ "path": "/api/analyze-creatives",  "schedule": "0 12 * * *" }  // 12h: atualiza métricas dos criativos
```

O cron de criativos roda diariamente mas **não re-analisa imagens** — apenas atualiza CTR, CPC, impressões. Re-análise de imagem só acontece manualmente via dashboard ou `?force=1`.

---

## Etapa 3 — Cache de Sugestões (`suggest-creative.js` + Supabase)

### Por que existe
Cada chamada ao sugestor custa tokens do Claude. O cache evita re-processar quando os dados não mudaram.

### Como funciona
- Chamada normal (`GET /api/suggest-creative`): retorna o resultado salvo na tabela `ai_suggestions` sem chamar o Claude
- `?force=1`: ignora o cache, recalcula tudo e salva o novo resultado
- O dashboard chama automaticamente na abertura para exibir o último resultado
- O botão "Regerar Sugestões" chama com `force=1`

### Tabela `ai_suggestions`
```sql
CREATE TABLE ai_suggestions (
  id TEXT PRIMARY KEY DEFAULT 'latest',  -- sempre uma única linha
  suggestion JSONB,   -- { champion: {...}, test: {...} }
  math JSONB,         -- resumo dos dados que geraram a sugestão
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

A resposta inclui `cached: true/false` e `cached_at` com o timestamp da última geração.

---

## Etapa 4 — Templates de Prompt Visual (`suggest-creative.js`)

### O que são
Templates são estruturas de prompt fotográfico pré-definidas. Em vez de o Claude inventar um prompt do zero, ele escolhe o template mais adequado e adapta para o produto e hook.

### Os 6 templates disponíveis

| Chave | Nome | Estilo |
|---|---|---|
| `editorial_saude` | Editorial Saúde | Revista de saúde, 85mm, luz natural, empoderador |
| `lifestyle_ugc` | Lifestyle Autêntico | Conteúdo real/UGC, cotidiano, sem maquiagem |
| `antes_depois` | Antes/Depois Emocional | Composição dividida, transformação ansiedade → confiança |
| `close_produto` | Close Produto + Mão | Foco na caneta, fundo mármore, macro, premium |
| `depoimento_camera` | Depoimento / Câmera Direta | Olhando para a câmera, sala de estar, documentário |
| `empoderamento` | Motivacional | Estilo Nike/campanha aspiracional, golden hour |

### Como o Claude escolhe
O prompt enviado ao Claude inclui:
1. A performance histórica de cada template (CTR médio, score, criativos rodados)
2. Quais templates ainda não foram testados
3. A estrutura base de cada template

**Para o Campeão:** Claude escolhe o template com melhor score histórico (ou o mais adequado se não houver dados)
**Para o Teste:** Claude escolhe um template não testado ou de menor score para validar

### Como adicionar um novo template
Apenas adicione uma entrada no objeto `PROMPT_TEMPLATES` em `suggest-creative.js`:
```js
novo_estilo: {
  label: 'Nome Legível',
  description: 'Descrição do estilo para contexto',
  structure: 'Prompt base em inglês com estilo fotográfico detalhado...',
},
```
O Claude vai incluí-lo automaticamente nas próximas sugestões.

### Loop de aprendizado dos templates
```
Sugestão gerada (template escolhido)
  → Imagem gerada no dashboard
    → Criativo subido manualmente na Meta
      → analyze-creatives atualiza CTR/CPC no campo template_used
        → Ranking de templates no dashboard
          → Claude usa esse ranking na próxima sugestão
```

O campo `template_used` na tabela `creatives` é a ponte entre a geração e a performance real.

---

## Etapa 5 — Geração de Imagem (`generate-image.js`)

### Endpoint
`POST /api/generate-image`

Body:
```json
{
  "prompt": "texto do prompt",
  "aspectRatio": "1:1",
  "model": "nome-do-modelo-google",
  "template_used": "chave_do_template"
}
```

### Modelo
Usa a Google Generative AI API (`generativelanguage.googleapis.com/v1beta`) com `generateContent`.
O modelo é selecionável via dropdown no dashboard, populado dinamicamente por `/api/list-models`.
A seleção fica salva em `localStorage` no navegador.

### `/api/list-models`
Endpoint de diagnóstico que lista todos os modelos disponíveis com a `GOOGLE_AI_KEY` configurada no Vercel.
Filtra e retorna os modelos relacionados a geração de imagem separadamente.
Útil para descobrir quais modelos estão disponíveis quando um nome de modelo retorna erro 404.

### Variável de ambiente necessária
`GOOGLE_AI_KEY` — chave do Google AI Studio (não Vertex AI)

---

## Como Evoluir o Sistema

**Adicionar novo hook type:**
1. Incluir em `ALL_HOOK_TYPES` no `suggest-creative.js`
2. Incluir no prompt do `analyze-creatives.js` na lista de opções válidas

**Adicionar novo elemento visual:**
1. Incluir em `ALL_ELEMENTS` no `suggest-creative.js`
2. Incluir no prompt do `analyze-creatives.js` na lista de exemplos

**Ajustar o peso da fórmula de score:**
```js
function score(ctr, cpc, impressions) {
  const confidence = Math.min(impressions / 1000, 1); // aumentar 1000 = exige mais volume para confiar
  const ctrScore   = (ctr || 0) * 10;  // aumentar = valoriza mais CTR
  const cpcPenalty = (cpc || 0) * 2;   // aumentar = penaliza mais CPC alto
  return (ctrScore - cpcPenalty) * confidence;
}
```

**Adicionar novo template de prompt:**
1. Incluir nova entrada em `PROMPT_TEMPLATES` no `suggest-creative.js`
2. Nenhuma outra mudança necessária — o Claude descobre automaticamente

**Suporte a vídeo (futuro):**
- Campo `media_type` já existe na tabela (`'image' | 'video'`)
- No `analyze-creatives.js`, verificar `media_type` e enviar frame/thumbnail para o Claude Vision com prompt adaptado
- A lógica de score e agrupamento não precisa mudar

**Fechar o loop de templates automaticamente (futuro):**
- Quando o criativo for subido na Meta, salvar o `creative_id` da Meta junto com o `template_used` no Supabase
- O `analyze-creatives.js` já atualiza CTR/CPC pelo `creative_id` — o `template_used` será preenchido automaticamente

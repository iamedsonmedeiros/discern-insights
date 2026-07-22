# Plano: Análise DISCERN Multi-LLM com Consenso Cego

> Status: **Fase 0 ✅ · Fase 1 ✅ · Fase 2 ✅ · Fase 3 ✅** — funcionalidade completa de ponta a ponta.
> Objetivo: substituir a avaliação de modelo único (Gemini 2.5 Flash) por um painel de LLMs que avaliam a mesma página de forma cega e independente. O sistema calcula a média por item e sinaliza alerta quando os modelos divergem em mais de 1 ponto.
>
> **Ações manuais pendentes:**
> 1. ✅ Migrations aplicadas (content_snapshot, model_results, consensus).
> 2. ✅ Redis recriado (`vital-mammal-161762`).
> 3. ✅ Crédito OpenRouter adicionado ($5). Painel misto (Google + OpenRouter) verificado funcionando.
> 4. **Em produção (Vercel): setar `OPENROUTER_API_KEY` e `DISCERN_MODELS`.** Sem elas, o painel cai para só Gemini (default seguro).
> 5. **Faltou apenas exportação com colunas por modelo** (CSV/artigo) — item 3 da Fase 3 abaixo. Não bloqueia o uso.

---

## 1. Princípio central: "cego" exige insumo idêntico

Para a comparação entre modelos ser cientificamente válida (e defensável em artigo), **todos os modelos precisam avaliar exatamente o mesmo texto**, com o mesmo prompt e o mesmo schema de saída. Isso impõe três mudanças estruturais:

1. **Separar extração de análise.** Hoje `processUrl()` faz scraping + sumarização + análise em um passo só. A extração precisa virar uma etapa própria que produz um *snapshot* imutável do conteúdo, consumido depois por N análises.
2. **O snapshot é um só.** Se cada worker re-raspasse a URL, o conteúdo poderia mudar entre fetches (páginas dinâmicas, A/B tests, paywalls intermitentes) e a "cegueira" quebraria.
3. **Sumarização única (ou nenhuma).** Hoje textos >30k caracteres são resumidos pelo Gemini. Se cada modelo resumisse por conta própria, os insumos divergiriam. Pior: usar resumo do Gemini como insumo dos outros modelos introduz viés do Gemini em todo o painel.
   - **Recomendação:** eliminar (ou elevar muito) o limiar de sumarização. 30.000 caracteres ≈ 7,5k tokens — trivial para qualquer modelo de fronteira atual (contextos de 128k–1M tokens). Sugerir truncar/resumir só acima de ~300k caracteres. Isso simplifica o pipeline e remove uma fonte de viés.

---

## 2. Estratégia de cache (a pergunta do "temporário, permanente ou sem cache")

**Recomendação: híbrido em duas camadas, com papéis diferentes.**

### Camada 1 — Snapshot do conteúdo extraído: **permanente, no Postgres (Supabase)**
- Nova coluna/tabela guardando o texto extraído exatamente como foi enviado aos modelos (+ hash SHA-256 do texto, timestamp de extração, método usado: jina/fetch).
- **Por que permanente:** é uma ferramenta de pesquisa acadêmica. Reprodutibilidade exige saber *qual texto* cada modelo viu — a página web pode mudar ou sair do ar amanhã. O snapshot também habilita features futuras do roadmap (grounding com highlights, re-análise com modelos novos sem re-scraping, auditoria de artigo científico).
- Texto médio de página de saúde: 5–50 KB. Mesmo 10.000 análises ≈ centenas de MB — irrisório para Postgres. Se crescer, mover para Supabase Storage com referência na tabela.

### Camada 2 — Redis (Upstash): **temporário, para deduplicação operacional**
- `content:{url_normalizada}` → texto extraído, TTL **24h–72h**. Serve para: (a) os N workers de modelo lerem o snapshot rápido sem bater no Postgres; (b) se a mesma URL aparecer em outro job no mesmo dia, pular o Jina (economia direta de custo/latência de scraping).
- `analysis:{model_id}:{hash_do_conteudo}` → resultado por modelo, TTL **7 dias** (como hoje). Chavear por *hash do conteúdo* em vez de URL é mais correto: se a página mudou, o cache invalida sozinho; se duas URLs têm o mesmo texto, reaproveita.
- **"Sem cache" está descartado:** N modelos × re-scraping = N× custo de Jina + risco de insumos divergentes.

### Resumo da decisão
| Dado | Onde | Duração | Motivo |
|---|---|---|---|
| Texto extraído (snapshot) | Postgres | Permanente | Reprodutibilidade científica, auditoria, re-análise futura |
| Texto extraído (hot) | Redis | 24–72h | Dedup entre jobs, leitura rápida pelos N workers |
| Resultado por modelo | Redis | 7 dias | Evitar reprocessar mesma página no mesmo painel |
| Consenso calculado | Postgres | Permanente | É o resultado do produto |

---

## 3. Arquitetura de processamento: fan-out em dois estágios

Hoje: 1 mensagem QStash por URL → 1 worker faz tudo. Com 4–5 modelos, um worker único estouraria os 60s do Vercel Hobby e uma falha de um modelo forçaria retry de todos.

**Proposta (reaproveita o padrão de contadores atômicos já existente):**

```
Job (N URLs, M modelos)
  └─ Estágio 1: worker de EXTRAÇÃO (1 msg QStash por URL)
       - checa Redis content:{url} → senão, Jina/fetch
       - salva snapshot no Postgres + Redis
       - publica M mensagens QStash (uma por modelo)
  └─ Estágio 2: worker de ANÁLISE (1 msg por URL×modelo)
       - lê snapshot (Redis → fallback Postgres)
       - checa cache analysis:{model}:{hash}
       - roda o modelo com prompt/schema idênticos, temperatura 0
       - grava em analysis_model_results
       - RPC atômica increment_model_done(item_id)
       - se for o ÚLTIMO modelo do item → calcula consenso,
         grava em analysis_items, incrementa contador do job
```

- Cada worker de análise roda **1 modelo × 1 URL** → cabe folgado em 60s, retry isolado por modelo, e o QStash já dá throttling/retries de graça.
- O padrão "último worker fecha o item" é idêntico ao `increment_completed/increment_failed` já usado para fechar o job — mesma solução, um nível abaixo.
- **Falha parcial:** se 1 de 4 modelos falhar definitivamente (após retries), fechar o item com os modelos disponíveis e marcar `panel_incomplete = true` (consenso de 3 ainda é melhor que nada; exigir mínimo de 2).

---

## 4. Abstração de provedores

Genkit é Google-cêntrico. Duas opções:

- **Opção A (recomendada p/ v1): Vercel AI SDK + OpenRouter.** `generateObject()` do AI SDK aceita o mesmo schema Zod já definido em `perform-discern-analysis.ts` e funciona com qualquer provedor. OpenRouter dá **uma única chave/fatura** para GPT, Claude, Grok, Gemini, etc. Menos contas para gerenciar, troca de modelo é uma string.
- **Opção B: SDKs diretos** (openai, @anthropic-ai/sdk, google) — ~5–15% mais barato (sem markup do OpenRouter) e menor latência, porém 4+ chaves, 4+ dashboards de billing, 4 formatos de erro. Migrar para isso depois, se o volume justificar.

Interface proposta (fina, sobre o schema Zod existente):

```ts
interface DiscernEvaluator {
  id: string;            // ex: "openai/gpt-5.2", "anthropic/claude-sonnet-5"
  displayName: string;
  evaluate(input: { text: string; language: string }): Promise<PerformDiscernAnalysisOutput>;
}
```

O flow Genkit atual vira apenas o evaluator "gemini" — nada quebra.

### Painel de modelos sugerido (v1: 3 modelos, ímpar e barato)
| Papel | Modelo | Nota |
|---|---|---|
| Base atual | Gemini (tier flash mais recente) | continuidade com histórico |
| Segundo avaliador | GPT (tier mini/eficiente) | OpenAI |
| Terceiro avaliador | Claude (tier médio) | Anthropic |
| Opcionais fase 2 | Grok, Gemini Pro | painel de 5 p/ jobs "premium" |

⚠️ **Perplexity: não incluir no painel cego.** Os modelos Sonar fazem busca web em tempo real — o modelo veria conteúdo *além* do snapshot, quebrando a premissa de insumo idêntico. Se quiser Perplexity, usar como feature separada ("verificação de fatos com fontes"), não como avaliador cego.

**Configurações de rigor:** `temperature: 0` em todos; mesmo prompt (traduzido para nada — já é inglês); mesmo schema; nenhum modelo vê saída de outro (garantido por construção, rodam em paralelo isolados).

---

## 5. Modelo de dados

```sql
-- Resultado individual de cada modelo
create table analysis_model_results (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references analysis_items(id) on delete cascade,
  provider text not null,          -- "openai" | "anthropic" | "google" | "xai"
  model_id text not null,          -- id exato do modelo (para reprodutibilidade)
  status text not null,            -- pending | done | failed
  scores jsonb,                    -- os 16 itens
  justifications jsonb,
  domain_averages jsonb,
  usage jsonb,                     -- tokens in/out + custo estimado
  latency_ms int,
  error text,
  created_at timestamptz default now(),
  unique (item_id, model_id)       -- idempotência do worker
);

-- Em analysis_items, adicionar:
--   content_snapshot text          (ou ref p/ storage)
--   content_hash text
--   extraction_method text         ("jina" | "fetch")
--   consensus jsonb                (média, desvio, range por item)
--   divergence_flag boolean        (algum item com range > 1)
--   divergent_items text[]         (ex: {"item06","item10"})
--   panel_incomplete boolean

-- Em analysis_jobs, adicionar:
--   models text[]                  (painel escolhido no job)
-- + RPC increment_model_done(p_item_id) espelhando o padrão existente
```

## 6. Cálculo de consenso e regra de alerta

Por **item DISCERN (1–16)**, entre os M modelos:
- **média** (a nota final exibida), **range = max − min**, desvio padrão.
- **Alerta de divergência: `range > 1`** (interpreta "discordam em mais de 1 ponto" — ex: notas 2 e 4 alertam; 3 e 4 não). Flag por item + flag agregada no card.
- Médias de domínio (confiabilidade, qualidade do tratamento, geral) recalculadas sobre as médias consensuais — **não** média das médias dos modelos.

**Upgrade acadêmico (fase posterior, barato de adicionar):** reportar **ICC (intraclass correlation)** ou **Krippendorff's alpha** por job, tratando os LLMs como "avaliadores" — é exatamente a métrica de confiabilidade inter-avaliador que artigos com DISCERN já usam para humanos. Isso transforma a feature num argumento de publicação.

## 7. UI/UX

- **Seleção do painel** no formulário do job: checkboxes de modelos (mínimo 2, default 3), com estimativa de custo ao lado.
- **Result card:** nota consensual em destaque; expandível para tabela `item × modelo`; itens divergentes com badge âmbar ("⚠ modelos discordaram: 2 vs 4") e as justificativas lado a lado — é aí que o usuário decide manualmente (casa com o "human-in-the-loop" da Fase 1 do roadmap).
- **Progresso realtime:** a barra passa a contar URL×modelo (ou manter por URL e mostrar sub-progresso "2/3 modelos").
- **Exportações (CSV/artigo):** incluir média, SD, range, e por-modelo em colunas.

## 8. Custos — MEDIDOS (corrige a estimativa original)

> ⚠️ **Minha estimativa inicial de "3–5×" estava errada.** Medição real com `scripts/verify-panel.ts`
> numa página do NHS (snapshot de 8.600 caracteres, ~2,6–4,8k tokens de entrada):

| Modelo | Custo/página | Schema válido? |
|---|---|---|
| `googleai/gemini-2.5-flash` (atual, nativo) | **$0,00136** | ✅ |
| `openai/gpt-5.6-luna` | $0,01784 | ✅ |
| `google/gemini-3.5-flash` | $0,02207 | ✅ |
| `x-ai/grok-4.5` | $0,02782 | ✅ |
| `anthropic/claude-sonnet-5` | não testado (crédito acabou) | ? |
| **Painel de 4** | **$0,06909** | — |

**O painel de 4 custa ~50× o pipeline atual, não 3–5×.** O motivo: o Gemini 2.5 Flash é
excepcionalmente barato ($0,075/$0,30 por 1M tokens), enquanto os tiers de fronteira novos
custam $1,5–$2 / $6–$10 por 1M — 20–30× mais por token. A conta não é "3 modelos = 3× o custo";
é "3 modelos caros substituindo 1 modelo baratíssimo".

**Implicações práticas:**
- Um lote de 200 URLs sai de ~$0,27 (hoje) para ~$14 (painel de 4). Ainda viável para pesquisa,
  mas precisa de decisão consciente — e inviabiliza painel de 4 como default de um SaaS.
- Se o custo pesar, trocar por tiers *lite*: `google/gemini-3.1-flash-lite` ($0,25/$1,50 por 1M)
  é ~8× mais barato que o `gemini-3.5-flash` e provavelmente suficiente para pontuar DISCERN.
- **O cache deixou de ser otimização e virou requisito econômico.** Ver alerta abaixo.

> 🔴 **O Redis está morto.** O host em `UPSTASH_REDIS_REST_URL` (`new-pigeon-67695.upstash.io`)
> retorna NXDOMAIN — a instância Upstash não existe mais. O código degrada bem (avisa e segue sem
> cache), então nada quebra, mas hoje **não há cache nenhum**: toda análise repetida paga o preço
> cheio. Com painel multi-LLM isso multiplica o desperdício por 50. Recriar a instância Upstash e
> atualizar as env vars é pré-requisito da Fase 2.

## 9. Fases de implementação

**Fase 0 — Refatoração (sem mudança de comportamento) ✅ CONCLUÍDA**
1. Quebrar `processUrl()` em `extractContent(url)` e `analyzeContent(snapshot, model)`.
2. Dividir o cache Redis: `content:{url}` + `analysis:{model}:{hash}` (substitui o `analysis:{url}` atual).
3. Persistir `content_snapshot`/`content_hash` em `analysis_items`.
4. Elevar/remover o limiar de sumarização (avaliar tamanhos reais no histórico antes).
- *Critério de aceite:* pipeline atual (só Gemini) funciona idêntico, E2E Playwright verde.

**Fase 1 — Segundo avaliador ✅ CONCLUÍDA**
1. ✅ Interface `DiscernEvaluator` + adapter do flow Genkit atual (`src/ai/evaluators.ts`).
2. ✅ Adapter OpenRouter/AI SDK com `generateObject` + schema Zod compartilhado.
3. ✅ Tabela `analysis_model_results` + migração (`docs/migration_model_results.sql`).
4. ✅ Painel roda **dentro do worker atual** via `Promise.allSettled` (`runPanel` em `src/lib/content.ts`). Feature flag: env var `DISCERN_MODELS` (vazia ou 1 modelo = pipeline original).
- *Critério de aceite:* ✅ 4 de 5 modelos avaliaram a mesma URL às cegas com schema válido (`scripts/verify-panel.ts`). Falta só aplicar a migração para os registros irem ao banco.

**Descobertas da Fase 1 que mudam a Fase 2:**
- **Prompt e schema agora são canônicos** (`src/ai/discern-schema.ts`), compartilhados por todos os modelos — sem isso a comparação cega não vale. O schema antigo pedia que o *modelo* preenchesse `usage` (tokens), o que era alucinação pura; agora `usage` vem da metadata da API.
- **`maxOutputTokens` é obrigatório.** O SDK reserva 65k tokens de saída por default, o que infla a checagem de crédito dos provedores e derruba a chamada com HTTP 402. Fixado em 8.192.
- **A divergência é real e não é rara:** na página de teste, 2 dos 16 itens (item04 = fontes de informação, item12 = qualidade de vida) divergiram 2 pontos entre 4 modelos. A premissa da feature se confirma.

**Fase 2 — Fan-out por modelo + consenso ✅ CONCLUÍDA**
1. ✅ Worker de extração (`/api/worker/extract`) + worker de análise por modelo (`/api/worker/analyze` reescrito). `jobs/start` agora despacha para o estágio 1.
2. ✅ Fechamento do item pelo último worker via **compare-and-swap no status**, não RPC de contador (ver desvio abaixo).
3. ✅ Cálculo de consenso (`src/lib/consensus.ts`), `divergence_flag`, `divergent_items`, `panel_incomplete`.
4. Progresso realtime: contadores continuam por-URL (item bumpa o job 1×), então a barra existente segue correta sem mudança. Sub-progresso por modelo fica para a Fase 3.
- *Critério de aceite:* ✅ verificado com `scripts/verify-phase2.ts` — job de 3 modelos com 1 falha injetada: consenso calculado sobre os 2 que passaram, `panel_incomplete=true`, `divergence_flag=true` (item04, range 2), job fechado, idempotência confirmada (re-entrega não duplica).

**Desvios conscientes do plano original na Fase 2:**
- **Sem `increment_model_done`.** O plano previa um RPC contador por modelo. Em vez disso, o "sou o último?" conta linhas em `analysis_model_results` — que já tem `UNIQUE(item_id, model_id)`, então a contagem é idempotente de graça e uma reentrega do QStash sobrescreve a própria linha em vez de inflar um contador. Menos superfície, mesma garantia.
- **O fechamento do item é um CAS em `status='processing'`.** Se dois workers correrem para finalizar, o Postgres elege um só vencedor (o `UPDATE ... WHERE status='processing'` retorna linha para um só), e apenas ele bumpa o contador do job. É o mesmo padrão do fechamento de job que já existia, um nível abaixo.
- **Sumarização mora no worker de extração**, roda 1× e o snapshot congelado é o texto *pós-sumarização* — garante que todos os modelos leiam bytes idênticos e que o cache `analysis:{modelo}:{hash}` seja chaveado no que os modelos de fato viram.
- **Descoberta operacional:** vários ids de modelo Google que testei (`gemini-2.0-flash`, `gemini-2.5-flash-lite`, `gemini-2.5-pro`) retornam 404 "no longer available to new users" nesta chave. Só `gemini-2.5-flash` e `gemini-flash-latest` funcionaram. Vale validar qualquer id novo com `scripts/verify-panel.ts` antes de colocar no painel.

**Fase 3 — UI, métricas e exportação ✅ (parcial: exportação por modelo pendente)**
1. ✅ Seleção de painel no job (chips na seção "processar em segundo plano"), aba "Consenso" no card com tabela item×modelo, badges âmbar de divergência no header/aba/itens, justificativas lado a lado (carregadas sob demanda via `fetchModelResults`).
2. ICC/Krippendorff por job — **não implementado** (fica para depois; a base de dados já permite calcular a partir de `analysis_model_results`).
3. Exportações com colunas por modelo — **não implementado** (os exports atuais mostram só o modelo primário).
4. (Opcional) Perplexity como verificador de fontes fora do painel cego — não implementado.

**Componentes/arquivos da Fase 3:**
- `src/ai/discern-schema.ts`: `DiscernRequestSchema` (sem min/max) + `normalizeDiscernOutput` (clamp 1–5). **Correção crítica:** o Anthropic rejeita `minimum`/`maximum` em `number` no structured output — sem isso o Claude não entrava no painel.
- `src/components/app/consensus-view.tsx`: a aba de consenso (matriz item×modelo, badges, justificativas lado a lado).
- `src/app/actions.ts`: `fetchModelResults(itemId)` (justificativas por modelo, lazy) e `fetchAvailableModels()` (chips de seleção).
- `getPanel(modelIds?)` agora aceita um painel por-job; `jobs/start` valida a seleção do cliente contra o painel permitido e grava em `analysis_jobs.models`; os workers leem o painel do job.

**Custo real do painel default (3 modelos) medido:** ~$0,08/página (Gemini + GPT + Grok). Divergência real observada na página de teste: 4 de 16 itens (item04 fontes, item08 incerteza, item12 qualidade de vida, item14 decisão compartilhada) — em todos, o Gemini pontuou 4–5 enquanto GPT/Grok pontuaram 2–3. É exatamente o tipo de discordância que a feature existe para expor.

**Limitação de verificação:** a UI foi validada por (a) build de produção, (b) typecheck, (c) contrato de dados exato contra um item real semeado (`scripts/verify-phase3-data.ts`), (d) testes unitários do consenso. O render visual em si depende de login (auth por cookie SSR) e ficou para conferência do usuário — item de DEMO semeado no histórico da conta para esse fim.

## 10. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Schemas estruturados se comportam diferente entre provedores (nem todo modelo respeita `min/max` do JSON schema) | Validação Zod pós-resposta + 1 retry com mensagem de correção; clamp 1–5 como último recurso |
| Rate limits distintos por provedor | QStash flow-control por rota/modelo (já usado no fan-out atual) |
| Custo 3–5× | Painel default de 3 modelos eficientes; painel de 5 opt-in; cache por hash |
| Snapshot com lixo do scraper (menus, cookies banners) contamina todos os modelos igualmente | Aceitável para cegueira (viés uniforme), mas vale melhorar limpeza na Fase 0 |
| 60s de maxDuration | 1 modelo por invocação; timeout interno de ~45s por chamada de LLM |

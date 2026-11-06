# DISCERN Insights

Web app that scores health pages with the DISCERN instrument (Charnock et al., 1999, University of Oxford). You import a Google results spreadsheet, the app extracts each eligible page, a language-model panel rates the 16 questions, and the app computes means, agreement, and an IMRaD article draft.

Production: https://discern-insights.vercel.app

The behavior of the current code is documented in [docs/DOCUMENTACAO.md](docs/DOCUMENTACAO.md). Deferred work is listed in [docs/FUTURE_IMPROVEMENTS.md](docs/FUTURE_IMPROVEMENTS.md).

## What you do

1. Sign in with email and password (Supabase Auth).
2. On the Analyzer tab, import the `.xlsx` or `.csv` produced by the Chrome extension "Google Chrome URL Scraper". A pasted URL list also works.
3. Pick the model panel. An empty selection uses the full panel configured on the server (`DISCERN_MODELS`).
4. Start the run in the browser, one URL at a time, or send it to the server. You can close the tab after a background run. The app emails you when the batch finishes.
5. Read the queue, each page result, the consensus, and the agreement between models.
6. Export CSV, JSON, DOCX, the score matrix, or the long consensus file.
7. Generate the article draft. The interface language (PT or EN) is the manuscript language.

History keeps earlier batches. Statistics covers your own account. A global view appears only when `profiles.role` is `admin`.

Organic rows stay in search order. A URL that returns later in the search keeps its row and receives the first score. Tracking parameters such as `srsltid` do not make a second page. That repeated score stays out of the mean and out of the agreement calculation.

## Run locally

Node 22.

```bash
npm install
npm run dev
```

The app listens on http://localhost:9002.

Copy the variables below into `.env.local`. Do not commit that file.

| Variable | Use |
|---|---|
| `GOOGLE_API_KEY` | Gemini: scoring, long-page summary, article draft |
| `OPENROUTER_API_KEY` | The other panel models |
| `DISCERN_MODELS` | Comma-separated model ids. Empty means Gemini 2.5 Flash only |
| `DISCERN_MAX_OUTPUT_TOKENS` | Output cap. Default 8192 |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public key, used in the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | Workers. Never expose this to the client |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Snapshot and analysis cache |
| `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | Background queue |
| `RESEND_API_KEY` | Completion email |
| `NEXT_PUBLIC_APP_URL` | Link inside that email. Locally, http://localhost:9002 |
| `NEXT_PUBLIC_SITE_URL` | Login and password-reset return URL |

```bash
npm run typecheck
npx tsx scripts/test-search-import.ts
npm run test:e2e
```

A push to `main` deploys on Vercel. The SQL files in `docs/migration_*.sql` are the schema history. They are already applied. Do not run them again without reading what each one changes.

---

# DISCERN Insights

Aplicação web que avalia páginas de saúde com o instrumento DISCERN (Charnock et al., 1999, Universidade de Oxford). Você importa a planilha de uma busca no Google, a aplicação extrai cada página elegível, um painel de modelos de linguagem pontua as 16 questões, e a aplicação calcula médias, concordância e um rascunho de artigo no formato IMRaD.

Produção: https://discern-insights.vercel.app

O comportamento do código atual está em [docs/DOCUMENTACAO.md](docs/DOCUMENTACAO.md). O que ficou para depois está em [docs/FUTURE_IMPROVEMENTS.md](docs/FUTURE_IMPROVEMENTS.md).

## O que você faz

1. Entra com e-mail e senha (Supabase Auth).
2. Na aba Analisador, importa o `.xlsx` ou `.csv` gerado pela extensão Chrome "Google Chrome URL Scraper". Uma lista de URLs colada também serve.
3. Escolhe o painel de modelos. Uma seleção vazia usa o painel inteiro configurado no servidor (`DISCERN_MODELS`).
4. Inicia a análise no navegador, um endereço por vez, ou envia o lote para o servidor. Depois do envio, a aba pode fechar. A aplicação manda um e-mail quando o lote termina.
5. Lê a fila, o resultado de cada página, o consenso e a concordância entre modelos.
6. Exporta CSV, JSON, DOCX, a matriz de notas ou o consenso em formato longo.
7. Gera o rascunho do artigo. O idioma da interface (PT ou EN) é o idioma do manuscrito.

O Histórico guarda os lotes anteriores. Estatísticas cobre a sua conta. A visão global só aparece quando `profiles.role` é `admin`.

As linhas orgânicas permanecem na ordem da busca. Um endereço que volta mais adiante mantém a linha e recebe a nota da primeira posição. Parâmetros de rastreamento, como `srsltid`, não criam uma segunda página. Essa nota repetida fica de fora da média e do cálculo de concordância.

## Rodar localmente

Node 22.

```bash
npm install
npm run dev
```

A aplicação sobe em http://localhost:9002.

Copie as variáveis abaixo para `.env.local`. Não envie esse arquivo ao repositório.

| Variável | Uso |
|---|---|
| `GOOGLE_API_KEY` | Gemini: nota, resumo de página longa e rascunho do artigo |
| `OPENROUTER_API_KEY` | Os outros modelos do painel |
| `DISCERN_MODELS` | Ids separados por vírgula. Vazio significa só o Gemini 2.5 Flash |
| `DISCERN_MAX_OUTPUT_TOKENS` | Teto de saída. Padrão 8192 |
| `NEXT_PUBLIC_SUPABASE_URL` | Projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave pública, usada no navegador |
| `SUPABASE_SERVICE_ROLE_KEY` | Workers. Não exponha isto no cliente |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Cache do texto e da análise |
| `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | Fila do segundo plano |
| `RESEND_API_KEY` | E-mail de fim de lote |
| `NEXT_PUBLIC_APP_URL` | Link nesse e-mail. Em local, http://localhost:9002 |
| `NEXT_PUBLIC_SITE_URL` | Retorno do login e da recuperação de senha |

```bash
npm run typecheck
npx tsx scripts/test-search-import.ts
npm run test:e2e
```

Um push na branch `main` publica na Vercel. Os arquivos SQL em `docs/migration_*.sql` são o histórico do banco. Eles já foram aplicados. Não rode de novo sem ler o que cada um altera.

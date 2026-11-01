# DISCERN Insights

Documento de referência da aplicação em produção. Descreve o comportamento do código em novembro de 2026. É a documentação completa: o README só indica este arquivo.

A aplicação avalia a qualidade de páginas de saúde na web com o instrumento DISCERN (Charnock et al., 1999; Universidade de Oxford). O pesquisador importa os resultados de uma busca no Google, a aplicação extrai o texto de cada página elegível, um painel de modelos de linguagem pontua as 16 questões, e o sistema calcula médias, concordância e um rascunho de artigo no formato IMRaD.

Endereço em produção: https://discern-insights.vercel.app

## 1. O que o pesquisador faz

1. Entra com e-mail e senha (Supabase Auth). A raiz `/` manda quem já está autenticado para `/dashboard` e os demais para `/login`.
2. Na aba Analisador, importa as URLs. O caminho previsto é a planilha `.xlsx` ou `.csv` gerada pela extensão Chrome "Google Chrome URL Scraper". Também aceita uma lista colada ou um arquivo só de URLs.
3. Escolhe os modelos do painel. Uma seleção vazia usa o painel inteiro configurado no servidor.
4. Inicia a análise de um de dois jeitos:
   - **Iniciar**, no navegador: uma URL de cada vez, com a aba aberta. Respeita os modelos marcados.
   - **Enviar para segundo plano**: o servidor processa o lote. A aba pode fechar. Ao terminar, o sistema tenta enviar um e-mail.
5. Lê a fila, o resultado de cada página, o consenso e a concordância entre modelos.
6. Exporta CSV, JSON, DOCX, a matriz de notas ou o consenso em formato longo.
7. Gera o rascunho do artigo. O tema vem pré-preenchido com a palavra-chave da fila ou com o termo da planilha. O idioma do manuscrito é o idioma da interface.

Há ainda as abas Histórico (lotes anteriores) e Estatísticas (indicadores da própria conta; a visão global só aparece para quem tem `profiles.role = admin`).

A interface tem seletor PT | EN no cabeçalho. O padrão é português do Brasil. A escolha fica em `localStorage`, chave `discern-locale`. As abas Histórico e Estatísticas ainda têm trechos fixos em português.

A fila guarda no máximo 200 linhas.

## 2. A planilha de busca e a ordem das páginas

A extensão registra cada item da página de resultados do Google. A aplicação reconhece o arquivo quando encontra as colunas `tipo` e `url`. O CSV usa ponto e vírgula e pode vir com BOM UTF-8. O `.xlsx` é lido no servidor (SheetJS), depois de o navegador enviar o arquivo em base64.

Colunas usadas:

| Coluna | Uso |
|---|---|
| `termo` | Termo da busca. Vira o tema sugerido do artigo. |
| `pagina` | Página de resultados (1, 2, 3…). |
| `posicao_geral` | Posição na busca inteira, contando também os blocos que não são orgânicos. Vira o número `#` da fila. |
| `posicao_pagina` | Posição dentro daquela página. |
| `tipo` | `organico`, `ia`, `anuncio`, `mapa`, `outro`, etc. |
| `subtipo` | Detalha `outro`: `paa`, `video`, `buscas_relacionadas`, e outros. |
| `url` | Endereço. Só entra se começar com `http://` ou `https://`. |
| `coletado_em` | Dia da coleta. Aceita data ISO ou número de série do Excel (época 1899-12-30). |

Entram na fila todas as linhas com `tipo = organico` e URL válida, na ordem da planilha. Anúncio, visão geral de IA, mapa, "as pessoas também perguntam", bloco de vídeo e buscas relacionadas são contados e ficam de fora da fila. Um link do YouTube ou do Facebook que a planilha marcou como orgânico entra na fila; a elegibilidade do DISCERN o exclui depois, com status próprio, para o fluxo da amostra poder reportá-lo. O bloco de vídeo da página 1, com `tipo` diferente de `organico`, não entra.

A coluna `#` é a `posicao_geral`. Os números pulam onde havia um bloco não orgânico. Na coleta de "câncer de pele" de 26 de outubro de 2026, a primeira posição orgânica é a 4, da Sociedade Brasileira de Dermatologia.

### Endereço que aparece mais de uma vez

A ordem da busca é a ordem da análise. O mesmo URL em posições diferentes gera uma linha por posição. Só a primeira posição (o menor `#`) é extraída e pontuada. Cada posição seguinte recebe a mesma nota, o mesmo status e o mesmo texto, e guarda em `meta.sameScoreAs` o id da linha que foi de fato analisada. Essa nota repetida aparece na fila, no cartão de resultado e na matriz de modelos. Ela não entra de novo na média, no ICC nem no fluxo da amostra do artigo.

O resumo da planilha (quantas linhas, quantas páginas, quantos orgânicos, quantos endereços únicos, o que ficou de fora) fica no `localStorage` do navegador, chave `discern-search-imports`. Limpar a fila apaga esse resumo. Outro navegador, ou uma fila importada antes deste recurso, só passa a ter esses números depois de importar a planilha de novo.

Reimportar o mesmo arquivo não duplica linha: a chave é `url` + posição. Importar uma segunda planilha diferente acrescenta outro resumo; endereços que aparecem nas duas podem ser contados duas vezes no texto do artigo.

## 3. Quem entra no estudo

A triagem por URL está em `src/lib/eligibility.ts`. A mesma lista alimenta o rodapé do painel.

| Status | O que é | Por quê |
|---|---|---|
| `completed` | Página com texto escrito: artigo, hospital, sociedade, governo, blog. Artigo do LinkedIn Pulse (`linkedin.com/pulse/…`) entra, porque é texto longo. | Formato para o qual o DISCERN foi feito. |
| `not_eligible_social` | Qualquer URL de Facebook, Instagram, TikTok, X/Twitter, Threads, LinkedIn (exceto Pulse), Pinterest, Reddit, Kwai, Telegram e WhatsApp. Atalho `lnkd.in` fica de fora porque esconde o destino. | Posts são curtos, dependem de mídia e comentários e muitas vezes exigem login. |
| `not_eligible_video` | YouTube, Vimeo, Dailymotion, Twitch, Rumble. Também uma página cujo conteúdo principal é um vídeo embutido e o texto extraído tem menos de 1.500 caracteres. | O DISCERN avalia texto. Não há transcrição. |
| `not_eligible_pdf` | Caminho que termina em `.pdf`, ou resposta com `content-type` `application/pdf`. | O estudo avalia páginas web. |
| `scraping_error` | HTTP 401, 403 ou 429, página de verificação de bot, ou menos de 500 caracteres de texto. | Não há texto avaliável. Dá para colar o texto na análise manual. |
| `unavailable_offline` | Outro erro HTTP (404, 500…). | A página não abre. |
| `analysis_error` | Todos os modelos do painel falharam. | Não há nota. |

Essas linhas permanecem na fila. Médias, consenso, ICC e artigo usam só as concluídas com a versão atual do instrumento.

A frase "Nenhuma página foi excluída por ser um arquivo PDF" é a contagem zero dessa categoria no fluxo da amostra. Ela não afirma que PDFs fazem parte do escopo. O rodapé continua dizendo que o estudo avalia páginas web.

## 4. Extração do texto

Cada URL elegível é lido uma vez. O texto fica congelado em `content_snapshot`, com SHA-256 em `content_hash` e o método em `extraction_method` (`jina` ou `fetch`). Todos os modelos leem esses mesmos bytes.

Ordem:

1. Jina (`https://r.jina.ai/{url}`), formato Markdown, tempo limite de 15 segundos. Se o Jina devolver "Target URL returned error", a aplicação tenta o fetch direto.
2. Fetch direto, com tempo limite de 20 segundos, se o Jina veio vazio.
3. `scraping_error` ou `unavailable_offline`, com o motivo gravado na linha.

Páginas com mais de 300.000 caracteres passam por um resumo do Gemini 2.5 Flash antes do painel. O resumo acontece uma vez por snapshot, no worker de extração, para os modelos não lerem textos diferentes. Abaixo desse tamanho o texto vai inteiro.

O Redis guarda o snapshot por 48 horas (`content:{url normalizada}`) e o resultado de cada modelo por 7 dias. A chave da análise inclui a versão do instrumento: `analysis:discern-official-v2:{modelo}:{hash}`. Um resultado de uma versão antiga do questionário não é reaproveitado.

## 5. O instrumento

A fonte única das 16 questões, das dicas e da escala é `src/lib/discern-items.ts`. O prompt, o schema, a interface, as exportações e o artigo leem essa lista. A versão atual é `discern-official-v2`.

As questões em inglês seguem o DISCERN Handbook (1997). A dica da questão 4 também aceita links externos, como no instrumento online. Os rótulos em português são a tradução validada de Logullo et al., Value in Health Regional Issues, 2019;20:172-9.

| Bloco | Questões | O que a média representa |
|---|---|---|
| Confiabilidade | 1 a 8 | Média das questões respondidas. |
| Qualidade da informação sobre tratamento | 9 a 15 | Média das questões respondidas. |
| Qualidade geral | 16 | A própria nota da questão 16. |

Escala das questões 1 a 15: 1 = Não, 2 a 4 = Parcialmente, 5 = Sim. A questão 16 vai de baixa a alta qualidade (1, 3 e 5 têm âncoras no manual).

O código, em `normalizeDiscernOutput`, aplica duas regras do manual depois que o modelo responde:

- Se a questão 1 é 1 (Não), a questão 2 fica sem nota (`null`) e sai da média. Se a questão 1 é parcial e a 2 veio vazia, a 2 vira 1.
- Se a questão 4 é 1, a questão 5 não pode ser 4 ou 5; o código reduz para 3.
- Qualquer outra questão vazia vira 1. "Não se aplica" além da questão 2 ainda não existe. Critério não cumprido vale 1.

As médias de domínio são calculadas pelo código, a partir das notas. O modelo não as inventa.

Análises sem `instrumentVersion = discern-official-v2` usaram um conjunto antigo de itens (a questão 10, benefícios, faltava). Elas continuam visíveis, com aviso, e ficam fora das estatísticas, do ICC e do artigo. Para incluí-las, é preciso reprocessar a URL.

## 6. O painel de modelos

Cada modelo recebe o mesmo prompt e o mesmo schema. A temperatura dos avaliadores via OpenRouter é 0. O teto de tokens de saída é `DISCERN_MAX_OUTPUT_TOKENS` ou 8.192.

O painel vem da variável `DISCERN_MODELS`, uma lista separada por vírgula. Se a variável estiver vazia, só roda o Gemini 2.5 Flash.

| Id | Caminho | Preço usado no custo (USD por 1 milhão de tokens, entrada / saída) |
|---|---|---|
| `googleai/gemini-2.5-flash` | Genkit, chave `GOOGLE_API_KEY` | 0,075 / 0,30 |
| `googleai/gemini-2.5-flash-lite` | Genkit | 0,10 / 0,40 |
| `google/gemini-3.5-flash` | OpenRouter | 1,50 / 9 |
| `openai/gpt-5.6-luna` | OpenRouter | 1 / 6 |
| `anthropic/claude-sonnet-5` | OpenRouter | 2 / 10 |
| `x-ai/grok-4.5` | OpenRouter | 2 / 6 |

Um id que não começa com `googleai/` só entra se `OPENROUTER_API_KEY` existir. O Gemini cobra a conta do Google, não a do OpenRouter. Um 402 nessa chave é crédito esgotado no Google AI.

A nota que a fila, o DOCX e o artigo reportam é a média do painel quando há consenso. Consenso exige pelo menos dois modelos com as 16 posições preenchidas (a questão 2 pode ser nula). Um modelo só não produz consenso.

Divergência: numa questão, a diferença entre a maior e a menor nota é maior que 1. Notas 3 e 4 concordam. Notas 2 e 4 divergem. A interface abre a aba de consenso quando há divergência.

O texto (resumo, observações, recomendações, justificativas) não é uma média. Ele vem do primeiro modelo do painel, na ordem configurada, que concluiu. O nome desse modelo é recuperado comparando as 16 notas com as colunas do consenso.

`panel_incomplete` fica verdadeiro quando algum modelo do painel falhou. A média, nesse caso, usa só quem concluiu.

A concordância entre modelos é o ICC de efeitos aleatórios de duas vias, concordância absoluta (Shrout e Fleiss, 1979): ICC(2,1) para um modelo e ICC(2,k) para a média do painel. A faixa de interpretação segue Koo e Li (2016): abaixo de 0,50 pobre, abaixo de 0,75 moderada, abaixo de 0,90 boa, e 0,90 ou mais excelente. O cálculo usa só os modelos presentes em todas as análises do lote e só casos completos. Notas idênticas em tudo deixam o ICC indefinido, em vez de reportar 1.

### Onde a pessoa entra

A página que mais muda o resultado quando alguém intervém é a que não foi lida. `scraping_error` (captcha, login, Cloudflare, texto com menos de 500 caracteres) deixa a URL na fila sem nota. A análise manual cola o texto e o painel avalia essa cópia. Sem esse texto, a página sai do estudo.

Sem consenso há um modelo só, ou nenhum. Com um modelo, a nota e o texto exibidos são os dele. Não há duas opiniões para arbitrar. Com nenhum, o status é `analysis_error` e não existe nota. Nos dois casos o trabalho é repetir a análise ou colar o texto, o mesmo caminho do `scraping_error`.

A leitura que rende para o julgamento DISCERN é a divergência: dois ou mais modelos pontuaram, e numa questão a diferença passa de 1 ponto. A aba de consenso marca esses itens e abre a justificativa de cada modelo. O método do artigo diz que isso fica para revisão humana. A nota gravada continua a média. Não há campo para a pessoa registrar a nota que escolheu. Esse recorte é pequeno de propósito. Revisar só as questões em que o painel se dividiu cabe num estudo. Revisar toda página sem consenso seria uma avaliação humana completa, que é o trabalho que o painel reduz.

Ordem prática: colar o texto das páginas bloqueadas, para a amostra não encolher à toa; nas questões divergentes, ler as justificativas e ficar com uma nota; no rascunho do artigo, porque a prosa é de um modelo e os campos de autoria continuam em branco.

## 7. Os dois modos de execução

### No navegador

`processNextAvailable` pega a próxima linha pendente, na ordem do `#`. Se uma linha anterior do mesmo URL já terminou, copia status, nota, consenso e snapshot, grava `sameScoreAs` e segue. Caso contrário chama `processUrl` com os modelos marcados. O navegador espera essa URL acabar antes de pedir a próxima. Dá para pausar e continuar. A análise manual fica na mesma linha da fila. Aceita o texto do artigo, o código-fonte da página (scripts, estilos e etiquetas saem antes da nota) ou um PDF com texto selecionável. Se a linha já pertence a um lote, ela não muda de lote. Uma página que já tinha sido contada como falha passa a contar como concluída, sem entrar duas vezes no total.

### Em segundo plano

`POST /api/jobs/start` cria um `analysis_jobs` com status `processing`, idioma, palavra-chave e a lista de modelos. O total do job é o número de linhas pendentes, incluindo as repetições. Todas recebem `job_id`. O QStash publica só a primeira ocorrência de cada URL, em `/api/worker/extract`. Cinco extrações saem juntas; o grupo seguinte espera 3 segundos.

O worker de extração só reivindica a linha se ela ainda está `pending`. Uma reentrega do QStash encontra a linha já tomada e sai. Se a extração termina (elegível ou não), `copyScoreToLaterPositions` preenche as posições seguintes que ainda estão pendentes e cada uma conta no progresso do job. Sem isso o job nunca chegaria ao total.

Texto elegível segue para um worker por modelo, em `/api/worker/analyze`. O último modelo a gravar fecha a linha, calcula o consenso e incrementa o contador. O incremento é uma função RPC no Postgres (`increment_completed` ou `increment_failed`), para duas entregas não contarem duas vezes. Se um modelo não grava linha nenhuma, quatro minutos depois `/api/worker/reconcile` registra essa falta e fecha a página com os modelos que responderam. O painel fica incompleto. Quando concluídas mais falhas igualam o total, o job passa a `done` e o Resend tenta o e-mail.

O e-mail sai de `DISCERN Insights <onboarding@resend.dev>`. Com esse remetente o Resend só entrega para o dono da conta. Um domínio verificado ainda não está configurado.

Workers exigem a assinatura do QStash. Em desenvolvimento, sem `QSTASH_TOKEN`, o cabeçalho `x-dev-bypass: 1` libera a rota.

Na Vercel, a extração e a análise têm teto de 60 segundos; a criação do job, 30.

## 8. O artigo

O botão abre um diálogo. O tema começa com a palavra-chave da fila ou com o termo da planilha. O manuscrito sai no idioma da interface.

Quem escreve a prosa é o Gemini 2.5 Flash, temperatura 0,4, via Genkit. Quem calcula os números é `formatArticleData` e `buildScoresTable`: fluxo da amostra, médias, desvios, ICC, período em que as páginas foram analisadas e a Tabela 1. O modelo recebe esses números prontos e a instrução de não recalculá-los.

A seção **Seleção das páginas** é texto fixo. Descreve a busca em www.google.com.br, interface em português do Brasil, país Brasil, janela sem conta nem histórico, personalização desligada, páginas lidas na ordem do Google, cada item classificado, anúncios não requisitados. Se a planilha foi importada neste navegador, o parágrafo inclui a frase com o total de resultados, os orgânicos, os endereços únicos e o que ficou de fora. Sem planilha, fica o colchete `[A preencher: número de páginas de resultado coletadas e a data da busca.]`. Depois que o modelo responde, `keepPageSelection` regrava esse parágrafo, para o modelo não inventar data nem número de páginas.

O período do estudo é o intervalo das datas em que as páginas incluídas foram analisadas, não a data da busca.

Métodos (elegibilidade, extração, DISCERN, estatística, ética) são texto fixo. O modelo só preenche os colchetes que pedem o fluxo da amostra, o painel e o período. Resultados, discussão e conclusão são prosa em volta dos números. A Tabela 1 (média e desvio por questão e por domínio) é acrescentada pelo sistema, em largura fixa, para o Apple Pages não esmagar as colunas.

Referências, em Vancouver, nesta ordem:

1. Eysenbach e Köhler, BMJ, 2002.
2. Eysenbach et al., JAMA, 2002.
3. Charnock et al., J Epidemiol Community Health, 1999.
4. Logullo et al., 2019, só no manuscrito em português.
5. Shrout e Fleiss, Psychol Bull, 1979.
6. Koo e Li, J Chiropr Med, 2016.

Sem ICC, as duas últimas saem da lista. Autores, afiliações, autor correspondente, agradecimentos e conflitos de interesse ficam como `[A preencher]`. Há uma declaração de uso de inteligência artificial nomeando o gemini-2.5-flash. O rascunho pede revisão dos autores.

O nome do arquivo usa o tema e o sufixo do idioma (`artigo` ou `article`).

## 9. Exportações

| Botão | Conteúdo |
|---|---|
| CSV | Uma linha por item da fila, com status, motivo, notas e domínios. |
| JSON | Os itens processados. |
| DOCX | Relatório por página, com a matriz de modelos. |
| Planilha de scores | Matriz questão por página. |
| Consenso (CSV longo) | Uma linha por questão, por página e por modelo. |

A nota exibida em todos eles passa por `getReportedScores`: média do painel quando há consenso, nota do único modelo quando não há.

## 10. Dados

Postgres no Supabase. O usuário lê as próprias linhas (RLS). Os workers gravam com a service role.

`analysis_items`: uma linha da fila. Campos que importam para reproduzir um estudo: `url`, `index` (posição geral), `status`, `reason`, `meta` (título, página da busca, posições, `sameScoreAs`), `discern_result`, `consensus`, `divergence_flag`, `divergent_items`, `panel_incomplete`, `models_total`, `content_snapshot`, `content_hash`, `extraction_method`, `model_id`, tokens, custo, `job_id`, `user_id`.

`analysis_jobs`: um lote em segundo plano. `total_urls`, `completed_urls`, `failed_urls`, `status`, `language`, `keyword`, `models`.

`analysis_model_results`: uma linha por item e por modelo (`UNIQUE (item_id, model_id)`). Guarda notas, justificativas, o resultado completo, tokens, custo, latência e erro. Uma posição repetida não ganha linhas novas; a interface lê a matriz pelo id em `sameScoreAs`.

`profiles`: `role`, `user` ou `admin`.

Os scripts SQL em `docs/migration_*.sql` são o histórico do schema. Eles já foram aplicados no projeto. Não rode de novo sem ler o que cada um altera.

## 11. Como rodar

Node 18 ou mais novo. `npm install`, depois `npm run dev`. A aplicação sobe em http://localhost:9002.

Variáveis:

| Variável | Para quê |
|---|---|
| `GOOGLE_API_KEY` | Gemini: avaliação, resumo de texto longo e redação do artigo. |
| `OPENROUTER_API_KEY` | Demais modelos do painel. |
| `DISCERN_MODELS` | Lista de ids, separada por vírgula. Vazia = só Gemini 2.5 Flash. |
| `DISCERN_MAX_OUTPUT_TOKENS` | Teto de saída. Padrão 8192. |
| `NEXT_PUBLIC_SUPABASE_URL` | Projeto Supabase. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave pública, no navegador. |
| `SUPABASE_SERVICE_ROLE_KEY` | Workers. Não vai para o cliente. |
| `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` | Cache de snapshot e de análise. |
| `QSTASH_TOKEN` e as chaves de assinatura do QStash | Fila do segundo plano. |
| `RESEND_API_KEY` | E-mail de fim de lote. |
| `NEXT_PUBLIC_APP_URL` | Link no e-mail. Em local, http://localhost:9002. |
| `NEXT_PUBLIC_SITE_URL` | Retorno do login e da recuperação de senha. |

`npm run typecheck` roda o TypeScript. `npx tsx scripts/test-search-import.ts` confere o parser da planilha. `npm run test:e2e` sobe o Playwright.

O deploy é a Vercel, no push da branch `main`.

## 12. Onde cada regra mora

| Regra | Arquivo |
|---|---|
| Questões, dicas, versão do instrumento | `src/lib/discern-items.ts` |
| Prompt único e regras de nota (questão 2 nula, questão 5 limitada) | `src/ai/discern-schema.ts` |
| Painel, preços, criação de avaliador | `src/ai/evaluators.ts` |
| Elegibilidade por URL | `src/lib/eligibility.ts` |
| Extração, cache, limiar de resumo | `src/lib/content.ts` |
| Planilha, ordem, frase da coleta | `src/lib/search-import.ts` |
| Cópia da nota para posições seguintes | `src/lib/jobs.ts` |
| Fan-out do lote | `src/app/api/jobs/start/route.ts` |
| Worker de extração | `src/app/api/worker/extract/route.ts` |
| Worker de análise | `src/app/api/worker/analyze/route.ts` |
| Consenso e divergência | `src/lib/consensus.ts` |
| ICC | `src/lib/reliability.ts` |
| Qual número é reportado | `src/lib/reported-scores.ts` |
| Números do artigo | `src/lib/article-data.ts` |
| Prosa, métodos fixos, referências, Tabela 1 | `src/ai/flows/create-scientific-article.ts` |
| Fila, importação, modos de início | `src/components/pages/discern-analyzer-page.tsx` |
| DOCX | `src/lib/utils.ts` |

## 13. Limites atuais

- A fila para em 200 linhas. Uma coleta com mais orgânicos do que isso precisa ser partida.
- O modo do navegador é sequencial. O lote grande vai pelo segundo plano.
- Sites com captcha, login ou Cloudflare continuam em `scraping_error`. A análise manual cola o texto. Um navegador real (Playwright) está descrito em `docs/FUTURE_IMPROVEMENTS.md` e ainda não existe.
- O resumo automático só começa aos 300.000 caracteres. Abaixo disso o modelo lê a página inteira, inclusive menu e rodapé que o extrator não tirou.
- O e-mail de conclusão só chega ao dono da conta Resend.
- O resumo da planilha vive no navegador. Trocar de máquina perde a frase de "Seleção das páginas" até uma nova importação.
- O modelo do artigo às vezes ainda escreve "significativo", apesar da proibição no prompt. Os números e o parágrafo de seleção das páginas não dependem dele.
- "Não se aplica" só existe para a questão 2. Nas outras, critério ausente vale 1.
- A revisão humana da divergência não grava uma nota. A média do painel segue na fila, nas exportações e no artigo. O campo para a nota da pessoa está em `docs/FUTURE_IMPROVEMENTS.md`.
- Histórico e Estatísticas não seguem o seletor de idioma por completo.

Itens adiados, com o problema e a solução já combinados, estão em `docs/FUTURE_IMPROVEMENTS.md`. O plano original do painel multimodelo, já implementado nas partes que este documento descreve, está em `docs/MULTI_LLM_CONSENSUS_PLAN.md`.

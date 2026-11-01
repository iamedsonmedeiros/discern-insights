# Melhorias futuras

Itens discutidos e adiados. Cada um diz o problema, a solução combinada e o que precisa existir antes de começar.

## 1. Extração com navegador real (Playwright num VPS)

**Problema.** Sites que exigem JavaScript ou devolvem uma tela de bloqueio simples terminam em `scraping_error`, e alguém precisa colar o texto à mão.

**Solução combinada.** Uma terceira tentativa em `extractContent` (`src/lib/content.ts`), depois do Jina e do fetch direto:

1. Jina. Se devolver texto utilizável, para aqui.
2. Fetch direto, se o Jina veio vazio sem ser bloqueio. Se o Jina já recebeu 401, 403 ou 429, pular o fetch.
3. Navegador, se ainda não há texto utilizável ou se o texto é uma página de verificação. Hoje um 403 ou uma página de verificação encerra o item; essa saída antecipada passa a cair aqui.
4. `scraping_error` com o convite à análise manual, se o navegador não trouxer pelo menos 500 caracteres.

O método vai para o snapshot (`jina`, `fetch` ou `browser`, em `ExtractionMethod`), para o artigo poder reportar quantas páginas precisaram de cada caminho.

**Onde roda.** Não na Vercel: o worker tem teto de 60 segundos e o Chromium não cabe na memória da função. Um serviço pequeno com Playwright num VPS próprio (preferido: amostra sua, sem preço por página) ou num serviço hospedado (Browserless, Browserbase) se não houver VPS com memória para dois Chromes.

- A Vercel faz um POST autenticado com um segredo e recebe título e texto.
- O serviço extrai o texto de `article` ou `main`, não da página inteira, para o modelo não avaliar menu, rodapé e aviso de cookie.
- No máximo dois Chromes ao mesmo tempo. O lote dispara 5 extrações em paralelo.

**Limite.** Captcha, login e verificação da Cloudflare continuam derrubando o Chrome automático com frequência. Nessas páginas a análise manual segue necessária. Um Chrome em datacenter não é o navegador de um paciente: região, banner de consentimento e captcha podem mudar o conteúdo.

**Antes de começar.** Escolher o VPS (ou o serviço hospedado), criar o segredo compartilhado e definir as variáveis de ambiente na Vercel.

## 2. Remetente próprio no Resend

O e-mail de fim de lote sai de `onboarding@resend.dev` (`src/lib/email.ts`). Com esse remetente o Resend só entrega para o e-mail da conta. Verificar um domínio no Resend e trocar o remetente para que qualquer usuário receba.

## 3. "Não se aplica" além da questão 2

O handbook permite deixar sem nota uma questão que realmente não se aplica (exemplo: não tratar, num texto sobre parto). Hoje só a questão 2 fica em branco, quando a 1 é "Não"; nas demais, critério não cumprido vale 1. Abrir o "não se aplica" exige regra no prompt, campo nulo no schema e tratamento nas médias, no consenso e no ICC (o cálculo já aceita nulo).

## 4. Autor da narrativa

**O que acontece hoje.** Cada modelo lê o mesmo texto e devolve as 16 notas e um texto próprio: resumo, observações, recomendações e uma justificativa por questão. As notas viram a média do painel. Três parágrafos não viram uma média, então a aba Resumo, o DOCX e o artigo mostram a prosa de um modelo só.

Esse modelo é o primeiro da lista do painel que concluiu. A ordem é a do lote (`analysis_jobs.models`), não a de quem respondeu primeiro. Se o Gemini está em primeiro e terminou, o resumo é dele, mesmo com o GPT e o Grok tendo escrito os seus. Se o Gemini falhou, entra o próximo da lista que concluiu. Quem escolhe é `finalizeItem` em `src/app/api/worker/analyze/route.ts`: ordena os que terminaram com `status = done` pela ordem do painel e grava o `result` do primeiro em `analysis_items.discern_result`.

Os outros textos ficam em `analysis_model_results`, um por modelo. A aba de consenso já mostra, questão a questão, a nota e a justificativa de cada um. O resumo, as observações e as recomendações de cada modelo não aparecem lado a lado.

**O problema.** A justificativa explica a nota daquele modelo, e o número em destaque é a média. O Gemini pode justificar um 2 na questão 6 enquanto a média do painel é 3,4. Quem lê o resumo sem abrir o consenso toma a explicação de um modelo como se fosse a da média.

**Alternativas, ainda sem escolha.**

1. Deixar o usuário escolher o autor. Continua um texto só na tela e no artigo, e a pessoa decide se a prosa oficial é a do Gemini, a do GPT ou a do Grok. As médias continuam as do painel.
2. Exibir um texto por modelo. O resumo, as observações e as recomendações de cada um aparecem como a aba de consenso já faz com as justificativas. O artigo passa a dizer de qual modelo veio cada trecho, ou deixa de citar essa prosa.

Os textos já estão gravados. Falta decidir qual das duas a interface e o artigo vão seguir.

## 5. Nota humana nas questões divergentes

**O que acontece hoje.** A pessoa muda mais o resultado quando a página não foi lida. `scraping_error` (captcha, login, Cloudflare, texto curto demais) fica sem nota até alguém colar o texto na análise manual. Sem consenso há um modelo só, ou nenhum (`analysis_error`). Com um modelo, a nota exibida é a dele e não há duas opiniões para arbitrar. Com nenhum, não existe nota. Nos dois casos o caminho já existe: repetir a análise ou colar o texto.

A leitura que rende para o julgamento DISCERN é a divergência. Dois ou mais modelos pontuaram, e numa questão a maior e a menor nota diferem em mais de 1 ponto. Notas 3 e 4 contam como acordo. Notas 2 e 4, não. A aba de consenso (`src/components/app/consensus-view.tsx`) marca esses itens e mostra a justificativa de cada modelo. O método do artigo diz que isso fica para revisão humana. A nota gravada continua a média do painel, na fila, no DOCX, nas estatísticas e no artigo.

Esse recorte é pequeno de propósito. Revisar só as questões em que o painel se dividiu cabe num estudo. Abrir revisão humana em toda página sem consenso voltaria a ser uma avaliação completa, que é o trabalho que o painel reduz.

**Problema.** A pessoa decide de cabeça. Não há campo para gravar a nota que ela escolheu, então a média segue no manuscrito.

**Solução combinada.** Um campo por questão divergente: a nota da pessoa e, se ela quiser, uma justificativa curta. Quando preenchida, essa nota entra no lugar da média naquela questão, nas exportações e no artigo. As notas dos modelos permanecem na matriz. `scraping_error`, `analysis_error` e página com um modelo só continuam no caminho atual (colar o texto ou repetir). A ordem de trabalho da pessoa é: colar o texto das páginas bloqueadas; nas questões divergentes, ler as justificativas e gravar uma nota; revisar o rascunho do artigo, porque a prosa é de um modelo e os campos de autoria continuam em branco.

**Antes de começar.** Definir se a nota humana substitui a média também no ICC ou se o ICC continua só com os modelos e a nota da pessoa aparece à parte.

## 6. Planilha modelo para quem não tem a extensão

**Problema.** A importação que preserva a ordem do Google, a posição geral, a página de resultados e o parágrafo **Seleção das páginas** só acontece quando o arquivo tem as colunas `tipo` e `url`, no formato da extensão Chrome. Quem cola uma lista de endereços entra na fila numerada 1, 2, 3, sem data, sem termo e sem contar o que ficou de fora. Quem não instalou a extensão não tem um arquivo vazio com essas colunas para preencher à mão.

**Solução combinada.** Um botão de download na área de importação entrega uma planilha `.xlsx` (e o mesmo conteúdo em `.csv` com ponto e vírgula) com o cabeçalho que `parseSearchRows` já reconhece:

| Coluna | O que a pessoa preenche |
|---|---|
| `termo` | Termo buscado. Vira o tema sugerido do artigo. |
| `pagina` | Página de resultados, a partir de 1. |
| `posicao_geral` | Posição na busca inteira, contando também os blocos que não são orgânicos. Vira o `#` da fila. |
| `posicao_pagina` | Posição dentro daquela página. |
| `tipo` | `organico`, `ia`, `anuncio`, `mapa` ou `outro`. Só `organico` entra na fila. |
| `subtipo` | Quando `tipo` é `outro`: `paa`, `video`, `buscas_relacionadas`, e os demais que a coleta já nomeia. |
| `url` | Endereço `http` ou `https`. Linha sem endereço é contada e não entra na fila. |
| `coletado_em` | Dia da coleta, `AAAA-MM-DD`. |

A primeira linha abaixo do cabeçalho é um exemplo, marcado para apagar. Uma segunda aba, ou um bloco de texto no topo, explica que a ordem das linhas é a ordem da busca, que o mesmo endereço em outra posição ganha outra linha, e que anúncio, visão geral de IA e blocos sem URL devem ser registrados mesmo sem entrar na análise. O arquivo importado segue o caminho que já existe: `importSpreadsheet`, resumo no navegador e frase de seleção das páginas.

**Antes de começar.** Fixar os valores permitidos de `tipo` e `subtipo` na folha de instruções, iguais aos rótulos de `src/lib/search-import.ts`, para o artigo nomear o que ficou de fora.

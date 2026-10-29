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

O resumo, as observações, as recomendações e as justificativas vêm do primeiro modelo do painel que concluiu. Alternativas: deixar o usuário escolher o autor, ou guardar e exibir um texto por modelo.

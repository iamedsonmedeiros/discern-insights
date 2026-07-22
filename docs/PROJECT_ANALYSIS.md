# DISCERN Insights - Análise do Projeto e Visão de Futuro

## 1. Visão Geral do Projeto
O **DISCERN Insights** é uma aplicação web robusta baseada em Inteligência Artificial que automatiza a análise de qualidade de informações de saúde online utilizando a metodologia **DISCERN** (desenvolvida pela Universidade de Oxford). A ferramenta atende pesquisadores, profissionais da área médica e criadores de conteúdo, permitindo a importação de URLs em lote, avaliação das páginas em relação aos 16 critérios DISCERN e a exportação de relatórios detalhados — incluindo até mesmo artigos científicos prontos para publicação no *Journal of Coloproctology*.

## 2. Arquitetura Técnica
A aplicação foi construída sob uma arquitetura serverless moderna, projetada para escalabilidade e processamento assíncrono.

- **Frontend:** Next.js 15.3.8 (App Router), React 18, Tailwind CSS 3.4, ecossistema ShadCN/UI, animações com Framer Motion e gráficos via Recharts.
- **Backend:** Next.js Server Actions e API Routes (para os webhooks).
- **Inteligência Artificial:** Google Genkit operando o modelo Gemini 2.5 Flash, com fluxos bem definidos para análise e sumarização.
- **Banco de Dados & Autenticação:** Supabase (PostgreSQL, Auth e subscrições Realtime).
- **Cache:** Upstash Redis (com TTL de 7 dias para URLs analisadas, evitando reprocessamento).
- **Filas e Background Jobs:** Upstash QStash, viabilizando o fan-out seguro do processamento das URLs.
- **Email:** Resend (notificações de conclusão de jobs).
- **Testes:** Cobertura End-to-End via Playwright.

## 3. Fluxos Principais

### Importação e Extração (Scraping)
- O sistema aceita URLs via texto livre ou upload de CSV (limite de 200 por lote).
- O conteúdo das páginas é extraído de forma limpa usando a API **Jina AI** primariamente, com fallback para `fetch` nativo. Há filtros de segurança inteligentes que pulam arquivos de vídeo, PDFs e bloqueios (como Cloudflare).

### Pipeline de IA
A inteligência opera em três etapas principais:
1. **Sumarização de Longos Textos:** Textos acima de 30.000 caracteres passam por um resumo inteligente que preserva os riscos e opções de tratamento.
2. **Análise DISCERN:** Avaliação estrita dos 16 critérios (escala 1 a 5) com validação de esquema (Zod), entregando justificativas por critério e médias estruturadas por domínio.
3. **Geração Científica:** Capacidade de gerar um manuscrito acadêmico em formato DOCX no padrão rigoroso do periódico alvo.

### Processamento Resiliente em Background
Ao ativar o modo automático, o backend registra o Job no PostgreSQL e publica mensagens no **QStash**. Os workers (rota `/api/worker/analyze`) processam as URLs isoladamente de modo idempotente. Para garantir a integridade do progresso sem lock contentions, são utilizadas funções **RPC no Postgres** para incrementos atômicos (`increment_completed` / `increment_failed`). O usuário é mantido atualizado no dashboard via **Supabase Realtime**.

---

## 4. Visão de Futuro e Pontos de Melhoria Estratégicos (Roadmap)

A base do projeto já é extremamente sólida (incluindo persistência, cache, mensageria e testes E2E). Olhando para o futuro e considerando o estado da arte de ferramentas de IA para saúde e pesquisa, aqui estão as principais evoluções identificadas:

### Fase 1: Qualidade Acadêmica e Ferramentas de Revisão (Curto Prazo)
1. **Edição com *Human-in-the-Loop***
   - **Problema:** A IA é probabilística. Em pesquisas acadêmicas estritas, o especialista deve ter a palavra final.
   - **Solução:** Permitir que usuários editem as notas (1-5) e as justificativas dadas pelo Gemini antes de travar o resultado para a exportação do artigo científico.
2. **Relatórios Visuais (PDFs com Gráficos de Radar)**
   - **Solução:** Exportar um dossiê em PDF (via `@react-pdf/renderer` ou `puppeteer`) mostrando a avaliação em um Gráfico de Radar (comparando a página vs qualidade ideal) para apresentação visual em reuniões de corpo clínico ou anexos de artigos.
3. **Análise Comparativa (Side-by-Side)**
   - **Solução:** Permitir selecionar 2 a 3 relatórios da base e renderizá-los em colunas pareadas, destacando onde um site foi superior ao outro nos domínios do DISCERN.

### Fase 2: Confiança da IA e Multimodelos (Médio Prazo)
1. **Consensus Scoring (Avaliação Multimodelo)**
   - **Problema:** Viés intrínseco de depender apenas de um modelo (Gemini 2.5).
   - **Solução:** Como descrito superficialmente nas anotações do projeto, criar um sistema onde Gemini, GPT-4o e Claude 3.5 avaliam a mesma página de forma cega. A nota final torna-se a média consensual, e discrepâncias severas alertam o usuário para revisão manual. 
2. **Aterramento (*Grounding*) Estrito com Highlights**
   - **Solução:** Obrigatória para sistemas de saúde. O Gemini, ao dar sua justificativa, deve também retornar a exata substring ("quote") extraída do site. A interface destacaria essa citação em amarelo no texto original do scraper.
3. **Classificação Automática de *Eligibility***
   - **Solução:** Implementar um passo de IA barato (ex: Gemini 2.5 Flash-8B) no início do fluxo apenas para responder: *"Isso é uma página de saúde válida?"*. Isso pouparia custos de processamento completo em artigos de opinião não relacionados.

### Fase 3: Modelo de Negócio, SaaS e Escala (Longo Prazo)
1. **Infraestrutura Própria de Scraping (Clusterização)**
   - **Problema:** O limite ou custo do Jina AI pode se tornar inviável em alta escala.
   - **Solução:** Uma pool de instâncias para Chromium headless usando ferramentas como Crawlee e proxies residenciais, garantindo a raspagem sem bloqueios institucionais.
2. **Gateway de API Pública e Webhooks**
   - **Solução:** Gerar tokens de API no painel do usuário para que organizações de saúde possam submeter URLs via requisições POST próprias e receber o resultado em um webhook de retorno.
3. **Monetização e Cobrança Baseada em Uso**
   - **Infra já existente:** A tabela `analysis_items` já calcula o custo (tracking de `input_tokens` e `output_tokens`).
   - **Próximo passo:** Integrar Stripe para faturamento (`metered billing`), onde o hospital ou pesquisador paga centavos por análise baseando-se no consumo exato de IA.

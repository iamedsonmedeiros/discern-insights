# Sugestões de Melhorias - DISCERN Insights

Este documento lista oportunidades de evolução para a plataforma, divididas por categorias de impacto e complexidade.

## 🚀 Prioridades (Alto Impacto / Médio Esforço)

### 1. Persistência de Dados (Banco de Dados) [CONCLUÍDO]
**Problema:** Atualmente, todos os dados são perdidos ao atualizar a página (F5).
**Sugestão:** Integrar um banco de dados (ex: Supabase, PostgreSQL ou MongoDB) para salvar as análises por usuário ou por projeto.
**Benefício:** Permite histórico de pesquisas, retomada de filas interrompidas e compartilhamento de links de resultados.

### 2. Processamento em Paralelo [CONCLUÍDO]
**Problema:** A análise é feita um por um, o que pode ser lento para filas grandes.
**Sugestão:** Implementar um processamento paralelo (ex: 3 a 5 URLs simultâneas) com controle de *rate limiting* da API do Gemini.
**Benefício:** Redução drástica no tempo total de espera.

### 3. Melhoria no Scraping (JS-Heavy Sites) [CONCLUÍDO]
**Problema:** O método atual (`fetch` simples) pode falhar em sites que carregam conteúdo via JavaScript (Single Page Applications).
**Sugestão:** Integrar um serviço de scraping mais robusto como Firecrawl, Jina AI ou uma instância de Playwright/Puppeteer.
**Benefício:** Maior taxa de sucesso na extração de conteúdo de portais de notícias modernos.

---

## ✨ Novas Funcionalidades

### 4. Edição Manual de Justificativas
**Sugestão:** Permitir que o revisor humano altere a nota ou a justificativa dada pela IA antes de exportar o relatório.
**Benefício:** Garante a acurácia final permitindo o "Human-in-the-loop".

### 5. Exportação em PDF
**Sugestão:** Além de DOCX, permitir a exportação direta em PDF com um layout mais visual (gráficos de radar para os scores DISCERN).
**Benefício:** Documentos prontos para apresentação direta a pacientes ou em prontuários.

### 6. Sistema de Autenticação [CONCLUÍDO]
**Sugestão:** Implementar NextAuth.js ou Clerk para permitir que usuários se cadastrem.
**Benefício:** Segurança dos dados e possibilidade de planos de uso (ex: limites de URLs por usuário).

### 12. Planilha de Scores (Matriz de Resultados) [CONCLUÍDO]
**Sugestão:** Exportar CSV simplificado com URL e apenas os 16 scores numéricos.
**Benefício:** Facilita análise estatística e comparação manual entre diferentes fontes.

---

## 🛠️ Infraestrutura e Qualidade

### 7. Testes Automatizados [CONCLUÍDO]
**Sugestão:** Adicionar testes E2E com Playwright para garantir que funcionalidades críticas (como a importação de URLs e o scroll da fila) não sofram regressões.
**Benefício:** Robustez e confiança em futuras manutenções.

### 8. Cache de Análises [CONCLUÍDO]
**Sugestão:** Implementar um cache (Redis ou similar) para URLs que já foram analisadas recentemente.
**Benefício:** Economia de tokens de IA e resultados instantâneos para links populares.

### 9. Dashboard de Estatísticas [CONCLUÍDO]
**Sugestão:** Uma visão geral que mostre a média de qualidade dos sites analisados no dia/semana, sites mais confiáveis vs menos confiáveis.
**Benefício:** Visão analítica macro do cenário de informações de saúde.

### 11. Processamento em Segundo Plano com Notificação por Email [CONCLUÍDO]
**Problema:** Atualmente, a aba do navegador precisa ficar aberta para que o processamento continue.
**Sugestão:** Mover a lógica de orquestração do navegador para o servidor usando:
- **Sistema de Filas:** Usar ferramentas como Upstash QStash ou BullMQ para gerenciar os "jobs" de análise.
- **Workers Independentes:** Processos no servidor que executam o scraping e a análise sem depender da interface.
- **Notificação Transacional:** Integrar Resend ou SendGrid para enviar um email automático ao usuário assim que toda a sua fila for processada.
**Benefício:** Liberdade para o usuário fechar o site após importar os links e garantia de conclusão de grandes volumes de dados (ex: +1000 URLs).

---

## 🎨 Interface (UI/UX)

### 10. Visualização Comparativa
**Sugestão:** Permitir selecionar 2 ou 3 sites na fila e gerar uma tabela comparativa de seus critérios DISCERN.
**Benefício:** Ajuda a identificar rapidamente qual a melhor fonte de informação sobre um tema específico.

---

## 🤖 Evolução de Inteligência (Multi-LLM)

### 13. Integração Multi-Modelo (Análise Comparativa)
**Objetivo:** Permitir que o DISCERN Insights utilize diferentes motores de IA para validar a mesma URL e gerar um "Score de Consenso".

**Estratégia Técnica:**
- **Roteador de Modelos:** Integrar via **OpenRouter** ou instâncias diretas (OpenAI, Anthropic, DeepSeek, Grok).
- **Schema do Banco de Dados:** Migrar de um campo único `discern_result` para um objeto de resultados mapeados por modelo:
  ```json
  {
    "gemini": { "scores": { ... }, "justification": "..." },
    "gpt-4o": { "scores": { ... }, "justification": "..." },
    "deepseek-v3": { "scores": { ... }, "justification": "..." }
  }
  ```
- **Consenso Automático:** Algoritmo que identifica discrepâncias (ex: Gemini deu 5, GPT deu 2) e destaca esses casos para revisão humana prioritária.
- **Dashboard de Modelos:** Visão geral de qual modelo é mais "rigoroso" ou "indulgente" na avaliação dos critérios DISCERN.

**Modelos Prioritários:**
1. **OpenAI (GPT-4o/o1):** Referência de mercado.
2. **DeepSeek V3/R1:** Custo-benefício extremo para grandes volumes.
3. **Grok (xAI):** Acesso a informações de tempo real do X (Twitter).
4. **Perplexity API:** Ideal para sites que exigem navegação de pesquisa avançada.

'use server';

/**
 * @fileOverview Generates a scientific article from DISCERN analysis data.
 *
 * Every number comes from `formatArticleData` and Table 1 from `buildScoresTable`;
 * the model only writes prose around them, in the interface language, about the
 * topic the user typed. The Methods text and the reference list are fixed here so
 * the manuscript describes what the system actually did and cites only checked works.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { buildScoresTable, formatArticleData, type ArticleItem } from '@/lib/article-data';
import type { DiscernLocale } from '@/lib/discern-items';
import { describeSearchImports, type SearchImport } from '@/lib/search-import';

const ARTICLE_MODEL = 'gemini-2.5-flash';

const CreateScientificArticleOutputSchema = z.object({
  articleContent: z.string().describe('The full scientific article manuscript formatted in Markdown.'),
});

export type CreateScientificArticleInput = {
  items: ArticleItem[];
  topic: string;
  locale: DiscernLocale;
  search?: SearchImport[];
};
export type CreateScientificArticleOutput = z.infer<typeof CreateScientificArticleOutputSchema>;

type ReferenceId = 'eysenbachKohler' | 'eysenbachReview' | 'charnock' | 'logullo' | 'shroutFleiss' | 'kooLi';

const REFERENCES: Record<ReferenceId, string> = {
  eysenbachKohler:
    'Eysenbach G, Köhler C. How do consumers search for and appraise health information on the world wide web? Qualitative study using focus groups, usability tests, and in-depth interviews. BMJ. 2002;324(7337):573-7.',
  eysenbachReview:
    'Eysenbach G, Powell J, Kuss O, Sa ER. Empirical studies assessing the quality of health information for consumers on the world wide web: a systematic review. JAMA. 2002;287(20):2691-700.',
  charnock:
    'Charnock D, Shepperd S, Needham G, Gann R. DISCERN: an instrument for judging the quality of written consumer health information on treatment choices. J Epidemiol Community Health. 1999;53(2):105-11.',
  logullo:
    'Logullo P, Torloni MR, Latorraca COC, Riera R. The Brazilian Portuguese version of the DISCERN instrument: translation procedures and psychometric properties. Value Health Reg Issues. 2019;20:172-9.',
  shroutFleiss:
    'Shrout PE, Fleiss JL. Intraclass correlations: uses in assessing rater reliability. Psychol Bull. 1979;86(2):420-8.',
  kooLi:
    'Koo TK, Li MY. A guideline of selecting and reporting intraclass correlation coefficients for reliability research. J Chiropr Med. 2016;15(2):155-63.',
};

// Order of first citation (Vancouver). The ICC references stay last so they can
// be dropped without renumbering when no panel was used.
const REFERENCE_ORDER: Record<DiscernLocale, ReferenceId[]> = {
  en: ['eysenbachKohler', 'eysenbachReview', 'charnock', 'shroutFleiss', 'kooLi'],
  'pt-BR': ['eysenbachKohler', 'eysenbachReview', 'charnock', 'logullo', 'shroutFleiss', 'kooLi'],
};

function citations(locale: DiscernLocale) {
  const order = REFERENCE_ORDER[locale];
  const cite = (id: ReferenceId) => `[${order.indexOf(id) + 1}]`;
  const list = order.map((id, i) => `${i + 1}. ${REFERENCES[id]}`).join('\n');
  return { cite, list };
}

function pageSelection(topic: string, locale: DiscernLocale, search?: SearchImport[]): { label: string; text: string } {
  const counts = search?.length ? describeSearchImports(search, locale) : null;
  if (locale === 'pt-BR') {
    return {
      label: 'Seleção das páginas',
      text: `As URLs foram coletadas na busca do Google pelo termo "${topic}". A busca foi feita em www.google.com.br, com a interface em português do Brasil e o país definido como Brasil, numa janela sem conta nem histórico, com a personalização desligada e o termo mantido exatamente como foi digitado. As páginas de resultado foram lidas uma a uma, na ordem em que o Google as apresentou, com pausas entre as páginas. Cada item foi registrado na posição em que apareceu e classificado como resultado orgânico, anúncio, resposta de inteligência artificial, mapa ou outro. Links de anúncios não foram requisitados. ${counts ?? 'A triagem do estudo usou os endereços coletados. [A preencher: número de páginas de resultado coletadas e a data da busca.]'}`,
    };
  }
  return {
    label: 'Page selection',
    text: `URLs were collected from a Google search for "${topic}". The search was run on www.google.com.br, with the interface in Brazilian Portuguese and the country set to Brazil, in a window without an account or history, with personalization turned off and the query kept exactly as typed. Result pages were read one by one, in the order Google displayed them, with pauses between pages. Each item was recorded in the position where it appeared and classified as an organic result, an advertisement, an AI-generated answer, a map, or other. Advertisement links were not requested. ${counts ?? 'The study screened the addresses collected. [To be completed: number of result pages collected and the date of the search.]'}`,
  };
}

/** The model rewrites this paragraph and invents the search date. Put the canonical text back. */
function keepPageSelection(article: string, topic: string, locale: DiscernLocale, search?: SearchImport[]): string {
  const { label, text } = pageSelection(topic, locale, search);
  const pattern = new RegExp(`\\*\\*${label}\\.\\*\\*[\\s\\S]*?(?=\\n\\*\\*)`);
  return pattern.test(article) ? article.replace(pattern, `**${label}.** ${text}\n`) : article;
}

function buildArticlePrompt({ analysisData, topic, locale, search }: { analysisData: string; topic: string; locale: DiscernLocale; search?: SearchImport[] }): string {
  const { cite, list } = citations(locale);
  const pt = locale === 'pt-BR';
  const selection = pageSelection(topic, locale, search);
  const language = pt ? 'português do Brasil' : 'inglês (English)';

  const h = pt
    ? {
        titlePage: 'Página de rosto',
        abstract: 'Resumo',
        intro: 'Introdução',
        methods: 'Métodos',
        results: 'Resultados',
        discussion: 'Discussão',
        conclusion: 'Conclusão',
        aiUse: 'Declaração de uso de inteligência artificial',
        acknowledgments: 'Agradecimentos',
        conflicts: 'Conflitos de interesse',
        references: 'Referências',
      }
    : {
        titlePage: 'Title Page',
        abstract: 'Abstract',
        intro: 'Introduction',
        methods: 'Methods',
        results: 'Results',
        discussion: 'Discussion',
        conclusion: 'Conclusion',
        aiUse: 'Use of artificial intelligence',
        acknowledgments: 'Acknowledgments',
        conflicts: 'Conflicts of Interest',
        references: 'References',
      };

  const titlePage = pt
    ? `**Autores:** [A preencher: nomes dos autores]
**Afiliações:** [A preencher: instituições]
**Título resumido:** [título resumido de até 40 caracteres, escrito por você]
**Autor correspondente:** [A preencher: nome, endereço e e-mail]`
    : `**Authors:** [To be completed: author names]
**Affiliations:** [To be completed: institutions]
**Short title:** [short title of up to 40 characters, written by you]
**Corresponding author:** [To be completed: name, address and email]`;

  const methods = pt
    ? `**${selection.label}.** ${selection.text}

**Elegibilidade.** Foram incluídas páginas da web com texto escrito. Antes de qualquer avaliação, as URLs foram triadas automaticamente e excluídas quando eram publicações em redes sociais (Facebook, Instagram, TikTok, X/Twitter, Threads, publicações do LinkedIn, Pinterest, Reddit, Kwai, Telegram, WhatsApp; artigos do LinkedIn Pulse foram aceitos como publicações escritas de formato longo), plataformas de vídeo ou páginas compostas apenas por vídeo, ou arquivos PDF, por estarem fora do escopo do instrumento DISCERN. Também foram excluídas páginas que bloquearam o acesso automatizado, retornaram erro HTTP ou forneceram menos de 500 caracteres de texto. [Reporte o fluxo da amostra com os números da seção "Sample flow".]

**Extração do conteúdo.** O texto principal de cada página incluída foi extraído uma única vez e congelado como uma cópia imutável, de modo que todos os avaliadores analisaram exatamente o mesmo conteúdo.

**Avaliação pelo DISCERN.** Foi aplicado o instrumento DISCERN ${cite('charnock')}, um questionário validado de 16 questões que avalia a confiabilidade da publicação (questões 1 a 8) e a qualidade da informação sobre as opções de tratamento (questões 9 a 15), com uma avaliação final da qualidade geral (questão 16). As questões 1 a 15 foram pontuadas na escala de 5 pontos do instrumento (1 = Não, critério não atendido; 2 a 4 = Parcialmente; 5 = Sim, critério plenamente atendido), e a questão 16 de 1 (baixa qualidade, deficiências graves ou extensas) a 5 (alta qualidade, deficiências mínimas). Os modelos receberam as 16 questões oficiais em inglês, com as dicas de avaliação do instrumento, e seguiram a regra de salto do manual: quando a questão 1 foi avaliada como Não, a questão 2 ficou sem nota e foi excluída da média. A questão 5 não recebeu nota alta quando a questão 4 foi avaliada como Não. Neste manuscrito, as questões são citadas na versão brasileira validada ${cite('logullo')}. [Descreva o painel com os dados da seção "Evaluation panel": quantos e quais modelos de linguagem avaliaram cada cópia de forma independente, com o mesmo prompt e o mesmo esquema de resposta, sem acesso às notas dos demais.] A nota de cada questão foi a média entre os modelos; as notas de domínio foram as médias das notas das questões (questões 1 a 8 e 9 a 15), e a nota geral foi a média da questão 16. Avaliações em que os modelos diferiram em mais de um ponto foram sinalizadas como divergentes para revisão humana.

**Análise estatística.** A análise estatística foi descritiva (média ± desvio padrão por questão e por domínio entre os sites). A concordância entre os modelos foi quantificada pelo coeficiente de correlação intraclasse (efeitos aleatórios de duas vias, concordância absoluta) ${cite('shroutFleiss')}: ICC(2,1) para a confiabilidade de um único modelo e ICC(2,k) para a confiabilidade da média do painel, interpretados segundo Koo e Li ${cite('kooLi')}. Não foram realizados testes de hipótese.

As páginas foram analisadas em [use o período da seção "Study period"].

**Aspectos éticos.** Este estudo analisou informações de acesso público e não envolveu participantes humanos.`
    : `**${selection.label}.** ${selection.text}

**Eligibility.** Web pages with written text were included. Before any evaluation, URLs were screened automatically and excluded when they were social media posts (Facebook, Instagram, TikTok, X/Twitter, Threads, LinkedIn posts, Pinterest, Reddit, Kwai, Telegram, WhatsApp; LinkedIn Pulse articles were accepted as long-form written publications), video platforms or video-only pages, or PDF files, as these formats fall outside the scope of the DISCERN instrument. Pages that blocked automated access, returned an HTTP error, or yielded fewer than 500 characters of text were also excluded. [Report the sample flow with the numbers from the "Sample flow" section.]

**Content extraction.** The main text of each included page was extracted once and frozen as an immutable snapshot, so that every evaluator assessed exactly the same content.

**DISCERN assessment.** The evaluation applied the DISCERN instrument ${cite('charnock')}, a validated 16-item questionnaire covering the reliability of the publication (items 1-8) and the quality of information on treatment choices (items 9-15), with a final overall quality rating (item 16). Items 1-15 were rated on the instrument's 5-point scale (1 = No, criterion not fulfilled; 2-4 = Partially; 5 = Yes, criterion completely fulfilled), and item 16 from 1 (low quality, serious or extensive shortcomings) to 5 (high quality, minimal shortcomings). Every model received the 16 official questions together with the instrument's rating hints, and followed its skip rule (when item 1 is rated No, item 2 is left unrated and excluded from the mean, as the handbook instructs). Question 5 was not rated high when Question 4 was rated No. [Describe the panel with the data from the "Evaluation panel" section: how many and which language models independently evaluated each snapshot, with the same prompt and response schema, without access to the other models' ratings.] The score of each item was the mean across models; domain scores were the means of the item means (items 1-8 and 9-15), and the overall score was the mean of item 16. Ratings where models differed by more than one point were flagged as divergent for human review.

**Statistical analysis.** Statistical analysis was descriptive (mean ± standard deviation per item and domain across websites). Agreement between models was quantified with the intraclass correlation coefficient (two-way random effects, absolute agreement) ${cite('shroutFleiss')}: ICC(2,1) for the reliability of a single model and ICC(2,k) for the reliability of the panel mean, interpreted according to Koo and Li ${cite('kooLi')}. No hypothesis tests were performed.

The pages were analyzed in [use the period from the "Study period" section].

**Ethical considerations.** This study analyzed publicly available information and did not involve human participants.`;

  const aiUse = pt
    ? `Este rascunho foi gerado por um modelo de linguagem (${ARTICLE_MODEL}) a partir dos dados calculados pelo sistema. Os autores devem revisá-lo e editá-lo, e assumem a responsabilidade pelo conteúdo.`
    : `This draft was generated by a large language model (${ARTICLE_MODEL}) from the data computed by the system. The authors must review and edit it, and take responsibility for its content.`;

  const toFill = pt ? '[A preencher]' : '[To be completed]';

  return `Você é um pesquisador sênior e especialista em redação científica. Sua tarefa é transformar os dados de uma avaliação da qualidade de páginas de saúde pelo instrumento DISCERN num artigo original, no formato IMRaD.

**Tema do estudo:** ${topic}
**Idioma do manuscrito:** ${language}

**Dados da análise (calculados pelo sistema):**
${analysisData}

**Regras:**

1.  **Tema.** O manuscrito inteiro trata da informação online sobre "${topic}". Não mencione outras especialidades ou doenças que não façam parte do tema.
2.  **Idioma.** Escreva tudo em ${language}, inclusive o título, os títulos de seção (use exatamente os títulos da estrutura abaixo) e o resumo. ${pt ? 'Use vírgula como separador decimal (ex.: 2,33 ± 0,70). Cite as questões do DISCERN com a redação que aparece nos dados.' : 'Quote the DISCERN questions with the wording in the data.'}
3.  **Números.** Todos os números (fluxo da amostra, médias, desvios padrão, ICC, divergências, período) já foram calculados e estão nos dados. Reporte exatamente esses valores; não recalcule nem invente números. As notas de cada site são a média do painel quando indicado ("mean of N models"); os textos qualitativos de cada site são de um único modelo, identificado em "Narrative below written by".
4.  **Nada inventado.** Não invente estratégia de busca, datas, autores, instituições, financiamento, testes estatísticos nem referências. Mantenha os trechos entre colchetes que dizem "${toFill}" ou "A preencher"/"To be completed" exatamente como estão. Os demais trechos entre colchetes são instruções para você: substitua-os pelo texto pedido.
5.  **Estatística.** Não houve teste de hipótese: não use "significativo(a)", "significativamente", "significant", "significantly" nem termos equivalentes em nenhuma seção, nem no sentido coloquial (prefira "importante", "marcado", "acentuado"). Descreva diferenças como descritivas.
6.  **Referências.** Use somente a lista de referências fornecida, citando pelo número entre colchetes, ex.: ${cite('charnock')}. Não acrescente referências. Para uma afirmação que precise de literatura fora da lista, escreva "${pt ? '[referência a inserir]' : '[reference to be added]'}". Não diga que os achados concordam com a literatura sem citar uma referência da lista. Se o ICC não for reportado (avaliação por modelo único), remova da lista as duas últimas referências e não as cite.
7.  **Painel.** Se os dados indicarem avaliação por modelo único, omita o painel, o ICC e as divergências.
8.  **Tabelas e figuras.** Não crie tabelas nem figuras. O sistema acrescenta a ${pt ? 'Tabela 1' : 'Table 1'} (média ± desvio padrão por questão e por domínio) ao final; refira-se a ela no texto dos resultados.
9.  **Tom.** Formal, acadêmico e objetivo. Não descreva a avaliação por modelos de linguagem como "imparcial", "objetiva" ou "sem viés"; diga que ela é padronizada e reprodutível.
10. **Limitações obrigatórias na discussão:** o DISCERN foi desenvolvido para avaliadores humanos e os modelos de linguagem não substituem esse julgamento; o tamanho da amostra; a análise retrata um momento específico; a seleção das páginas depende da estratégia de busca descrita nos métodos.
11. **Métodos.** Copie o texto fixo dos métodos como está, só preenchendo os trechos entre colchetes que pedem o fluxo da amostra, o painel ou o período da análise. O colchete final de "Seleção das páginas"/"Page selection" fica exatamente como está: não escreva o número de páginas nem a data da busca. O período em "Study period" é o da análise, não o da busca. Não coloque resultados (ICC, divergências, notas) nos métodos; eles vão nos resultados.
12. **Comparação entre sites.** Para dizer qual site teve a maior ou a menor nota num domínio, use a seção "Websites ranked by domain".
13. **Formato.** Markdown. Títulos de seção com "#". Separe as seções com uma linha contendo apenas "---".

**ESTRUTURA OBRIGATÓRIA:**

---

# ${h.titlePage}

## [Título claro e objetivo sobre a qualidade da informação online sobre ${topic}, baseado nos dados]

${titlePage}

---

# ${h.abstract}

**${pt ? 'Objetivo' : 'Objective'}:** [Objetivo do estudo: avaliar a qualidade da informação online sobre ${topic} com o instrumento DISCERN.]
**${pt ? 'Métodos' : 'Methods'}:** [Delineamento transversal descritivo; número de URLs triadas e incluídas; avaliação pelas 16 questões do DISCERN por um painel de modelos de linguagem (cite os modelos da seção "Evaluation panel"), com a nota de cada questão como média do painel e a concordância medida pelo ICC. Se houve modelo único, descreva assim.]
**${pt ? 'Resultados' : 'Results'}:** [Nota geral (questão 16), notas de confiabilidade e de qualidade da informação sobre tratamentos, com média ± DP; critérios com as maiores e as menores notas; ICC quando houver painel.]
**${pt ? 'Conclusão' : 'Conclusion'}:** [Conclusão sobre a qualidade da informação encontrada e suas implicações, sem extrapolar os dados.]

**${pt ? 'Palavras-chave' : 'Keywords'}:** [Até 6 termos ${pt ? 'DeCS' : 'MeSH'} relacionados a ${topic}, informação de saúde, internet e DISCERN.]

---

# ${h.intro}

[Contextualize a internet como fonte de informação de saúde para pessoas interessadas em ${topic} ${cite('eysenbachKohler')} e a preocupação com a qualidade dessa informação ${cite('eysenbachReview')}. Explique por que a qualidade da informação sobre opções de tratamento importa para a decisão do paciente nesse tema. Apresente o DISCERN como instrumento validado ${cite('charnock')}${pt ? `, com versão brasileira validada ${cite('logullo')}` : ''}. Termine com o objetivo do estudo. Não afirme que existe uma lacuna na literatura sem uma referência da lista.]

---

# ${h.methods}

${methods}

---

# ${h.results}

[Se existir a seção "Search collection", comece por ela: quantos resultados a planilha registrou, quantos eram orgânicos e quantos endereços únicos entraram na triagem. Depois o fluxo da amostra ("Sample flow"): quantas URLs foram triadas, quantas foram excluídas e por qual motivo, e quantas foram analisadas. Em seguida, a concordância entre os modelos (ICC(2,1), ICC(2,k) e o número de avaliações divergentes), quando houver painel.]

[Apresente as médias gerais: nota geral (questão 16), confiabilidade (questões 1 a 8) e qualidade da informação sobre tratamentos (questões 9 a 15), com média ± DP.]

[Detalhe os critérios com as maiores e as menores notas, usando os dados, e remeta à ${pt ? 'Tabela 1' : 'Table 1'}. Se houver sites que se destacam positiva ou negativamente, descreva-os pelos dados de cada site.]

---

# ${h.discussion}

[Interprete os resultados, sem apenas repeti-los: o que as notas significam para quem busca informação sobre ${topic}? Quais critérios do DISCERN são consistentemente bem ou mal atendidos e o que isso representa na prática?]

[Implicações para profissionais de saúde e para quem produz conteúdo sobre ${topic}.]

[Limitações obrigatórias (regra 10) e pontos fortes: a cópia imutável do conteúdo, o painel de modelos com concordância medida e a escala da análise.]

---

# ${h.conclusion}

[Responda ao objetivo em 2 a 3 frases, com base nos dados, e termine com uma recomendação.]

---

# ${h.aiUse}

${aiUse}

---

# ${h.acknowledgments}

${toFill}

---

# ${h.conflicts}

${toFill}

---

# ${h.references}

${list}
`;
}

export async function createScientificArticle(input: CreateScientificArticleInput): Promise<CreateScientificArticleOutput> {
  const topic = input.topic.trim();
  if (!topic) throw new Error('The article topic is required.');

  const analysisData = formatArticleData(input.items, input.locale, input.search);
  const { output } = await ai.generate({
    prompt: buildArticlePrompt({ analysisData, topic, locale: input.locale, search: input.search }),
    output: { schema: CreateScientificArticleOutputSchema },
    config: { temperature: 0.4 },
  });

  if (!output?.articleContent) throw new Error('The model returned no article.');

  const article = keepPageSelection(output.articleContent, topic, input.locale, input.search);
  const table = buildScoresTable(input.items, input.locale);
  const tablesHeading = input.locale === 'pt-BR' ? 'Tabelas' : 'Tables';
  return {
    articleContent: table ? `${article.trim()}\n\n---\n\n# ${tablesHeading}\n\n${table}\n` : article,
  };
}

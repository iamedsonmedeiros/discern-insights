'use server';

/**
 * @fileOverview Generates a scientific article from DISCERN analysis data.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import type { AnalysisItem } from '@/lib/types';


const CreateScientificArticleInputSchema = z.object({
  items: z.array(z.any()).describe('An array of completed analysis items.'),
});
export type CreateScientificArticleInput = z.infer<typeof CreateScientificArticleInputSchema>;


const CreateScientificArticleOutputSchema = z.object({
  articleContent: z.string().describe('The full scientific article manuscript formatted in Markdown.'),
});
export type CreateScientificArticleOutput = z.infer<typeof CreateScientificArticleOutputSchema>;


export async function createScientificArticle(input: CreateScientificArticleInput): Promise<CreateScientificArticleOutput> {
  return createScientificArticleFlow(input);
}

function formatAnalysisDataForPrompt(items: AnalysisItem[]): string {
    return items
        .map(item => {
            if (!item.discernResult) return '';

            const scores = Object.entries(item.discernResult.scores)
                .map(([key, score]) => `${key}: ${score}`)
                .join(', ');

            return `
Site: ${item.meta?.title || item.url}
URL: ${item.url}
Status: ${item.status}
- Resumo Executivo: ${item.discernResult.resumo}
- Observações: ${item.discernResult.observacoes}
- Recomendações: ${item.discernResult.recommmendacoes}
- Scores (1-5): ${scores}
- Score Geral: ${item.discernResult.domainAverages.score_geral}
- Média Confiabilidade: ${item.discernResult.domainAverages.confiabilidade}
- Média Qualidade do Tratamento: ${item.discernResult.domainAverages.qualidade_tratamento}
`;
        })
        .join('\n---\n');
}


const articleWriterPrompt = ai.definePrompt({
    name: 'articleWriterPrompt',
    input: { schema: CreateScientificArticleInputSchema },
    output: { schema: CreateScientificArticleOutputSchema },
    prompt: `Você é um pesquisador sênior e especialista em redação científica na área de coloproctologia. Sua tarefa é transformar uma análise de dados brutos sobre a qualidade de sites de saúde em um artigo original, pronto para submissão ao *Journal of Coloproctology*.

**Dados Brutos da Análise (Método DISCERN):**
{{{analysisData}}}

**Sua Tarefa:**

Você deve seguir **ESTRITAMENTE** as normas do *Journal of Coloproctology* para gerar o manuscrito.

1.  **Analise Comparativa Profunda:**
    *   Não apenas liste os dados. Identifique padrões, tendências, pontos fortes e fracos em todos os sites.
    *   Quais critérios do DISCERN são consistentemente bem ou mal avaliados?
    *   Existem outliers? Sites que se destacam (positiva ou negativamente)?

2.  **Gere o Manuscrito em INGLÊS no formato especificado abaixo:**
    *   Use Markdown para a formatação. Separe as seções principais com '---'.
    *   O tom deve ser formal, acadêmico e objetivo.

**ESTRUTURA OBRIGATÓRIA DO ARTIGO:**

---

# Title Page

## **[Título claro e objetivo em inglês sobre a qualidade da informação online em coloproctologia, baseado nos dados]**

**Authors:** Author A. Placeholder¹, Author B. Placeholder²
**Affiliations:** 1. Department of Fictional Studies, University of Example, City, Country. 2. AI Research Division, Genkit Institute, Virtual City, World.
**Short title:** Quality of online health information (<= 40 caracteres)
**Corresponding author:** A. Placeholder, University of Example. Email: placeholder@example.edu.

---

# Abstract

**Objective:** To evaluate the quality of online health information regarding coloproctological conditions using the DISCERN instrument.
**Methods:** A descriptive, cross-sectional study was conducted. Websites were identified through [descreva brevemente como foram encontrados, ex: 'common search engine queries']. The quality of information was assessed by an AI-powered tool based on the 16 items of the DISCERN methodology, covering reliability and quality of treatment information.
**Results:** [Sintetize os resultados principais aqui. Inclua a média geral de score, os scores médios de confiabilidade e qualidade. Destaque os critérios com maiores e menores pontuações. Ex: "The mean overall quality score was X.XX ± Y.YY. Reliability scores (mean = A.AA) were generally [higher/lower] than treatment quality scores (mean = B.BB). Items related to [e.g., 'source citation'] scored highest, while items concerning [e.g., 'description of risks'] scored lowest."]
**Conclusion:** [Conclua sobre a qualidade geral da informação encontrada e suas implicações. Ex: "The quality of online information for coloproctology patients is [variable/poor/moderate], with significant deficiencies in [mencione as áreas críticas]. There is a pressing need for higher-quality, evidence-based online resources."]

**Keywords:** Coloproctology, Health Information, Internet, Quality, DISCERN, Patient Education. (Use até 6 termos MeSH)

---

# Introduction

[Contextualize a importância da internet como fonte de informação de saúde para pacientes com condições colorretais. Explique por que a qualidade e a confiabilidade dessa informação são cruciais para a tomada de decisão do paciente e para a relação médico-paciente. Introduza o método DISCERN como uma ferramenta validada para essa avaliação. Aponte a lacuna que seu estudo preenche, por exemplo, a falta de uma análise sistemática recente da qualidade da informação online em coloproctologia usando ferramentas automatizadas de IA.]

---

# Methods

This study employed an automated analysis of publicly available health websites. The selection process mimicked typical patient behavior, using common search terms related to coloproctology on major search engines.

The core of the evaluation was performed by an AI agent trained to apply the DISCERN instrument (University of Oxford). This validated 16-item questionnaire assesses two main domains: the reliability of the publication (items 1-8) and the quality of information on treatment choices (items 9-15). A final item (16) provides an overall quality rating. Each item was scored on a 5-point scale (1=very poor, 5=excellent).

The analysis was conducted between [Mês/Ano] and [Mês/Ano]. Data extracted included the 16 individual scores, justifications, domain averages, and a qualitative summary for each website. Statistical analysis was descriptive, focusing on mean scores and standard deviations for each DISCERN item and domain across all evaluated websites.

**Ethical Considerations:** This study analyzed publicly available information and did not involve human participants. Therefore, approval from an ethics committee was not required, in accordance with the Declaration of Helsinki.

---

# Results

[Apresente a síntese dos achados de forma clara. Comece com uma visão geral: "A total of [número] websites were analyzed." Apresente as médias gerais: "The overall mean DISCERN score for all sites was [média] ± [desvio padrão]. The mean score for reliability (items 1-8) was [média], while the mean score for quality of treatment information (items 9-15) was [média]."]

[Detalhe os resultados por critério. "The highest-scoring criteria were [critério com maior pontuação] (mean score: X.XX) and [outro critério] (mean score: Y.YY). Conversely, the areas with the most significant quality gaps were [critério com menor pontuação] (mean score: A.AA) and [outro critério] (mean score: B.BB), indicating a general failure to discuss treatment uncertainties and risks." Use os dados para suportar essas afirmações.]

[**OBRIGATÓRIO:** Sugira a inclusão de uma tabela ou figura para visualização dos dados, ex: "(See Table 1 for a detailed breakdown of scores per DISCERN item)."]

---

# Discussion

[Interprete os resultados, não apenas os repita. O que os scores médios significam na prática? Compare seus achados com a literatura existente sobre a qualidade da informação de saúde online. As fraquezas que você encontrou (ex: falta de fontes, viés) são consistentes com outros estudos?]

[Discuta as implicações clínicas dos seus achados. Como a baixa qualidade da informação pode afetar as decisões do paciente, a ansiedade e a adesão ao tratamento em coloproctologia? Que recomendações você faria para os médicos (ex: orientar pacientes para sites confiáveis) e para os criadores de conteúdo?]

[Aponte as limitações do seu estudo. Ex: "This study has limitations, including the use of an automated AI tool, which, despite its training, may not capture all nuances a human evaluator would. The selection of sites was not exhaustive and represents a snapshot in time."]. Em seguida, ressalte a força do estudo, como a objetividade e escalabilidade da análise por IA.]

---

# Conclusion

[Responda diretamente ao objetivo do estudo. Resuma os principais achados em 2-3 frases. Ex: "This analysis reveals that the quality of online health information in coloproctology is highly variable and often fails to meet key quality criteria, particularly concerning the discussion of treatment risks and shared decision-making." Termine com uma recomendação forte e uma visão para o futuro. Ex: "Efforts from medical societies and healthcare providers are crucial to develop and promote high-quality online resources to empower patients and improve health outcomes in coloproctology."]

---

# Acknowledgments

The authors thank the AI agent for its tireless analysis.

---

# Conflicts of Interest

The authors declare no conflicts of interest.

---

# References

[**OBRIGATÓRIO:** Insira aqui de 3 a 5 referências relevantes em formato Vancouver. Inclua obrigatoriamente a referência do DISCERN.]

1. Charnock D, Shepperd S, Needham G, Gann R. DISCERN: an instrument for judging the quality of written consumer health information on treatment choices. J Epidemiol Community Health. 1999;53(2):105-11.
2. [Placeholder para outra referência relevante, ex: um estudo sobre uso da internet por pacientes]
3. [Placeholder para outra referência relevante, ex: um editorial sobre qualidade da informação]
`,
    config: {
        temperature: 0.4,
    },
});


const createScientificArticleFlow = ai.defineFlow(
    {
        name: 'createScientificArticleFlow',
        inputSchema: CreateScientificArticleInputSchema,
        outputSchema: CreateScientificArticleOutputSchema,
    },
    async (input) => {
        const analysisData = formatAnalysisDataForPrompt(input.items);
        
        const { output } = await articleWriterPrompt({
            analysisData: analysisData
        });

        return { articleContent: output!.articleContent };
    }
);

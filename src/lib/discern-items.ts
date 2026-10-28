// src/lib/discern-items.ts
//
// The DISCERN instrument — the single source of truth for the 16 questions,
// their rating hints and the rating scale.
//
// Wording checked against:
// - The DISCERN Handbook (British Library and University of Oxford, 1997): the
//   instrument (Part 4), the general instructions (Part 2), the list of terms
//   and the quick reference guide (Part 5).
// - The online instrument, which keeps the handbook questions and adds "external
//   links to the online sources" to the hint of question 4.
// - The validated Brazilian Portuguese questions: Logullo P et al. Value in
//   Health Regional Issues. 2019;20:172-179, supplementary questionnaire.
//
// The model schema, the evaluation prompt, the UI labels, the exports and the
// article all read from this list. Any edit here changes what the models score,
// so bump INSTRUMENT_VERSION with it: results from different versions must never
// be mixed in the same statistics.
//
// Pure data, no I/O — safe on client and server.

export const INSTRUMENT_VERSION = "discern-official-v2";

export type DiscernSection = "reliability" | "treatment" | "overall";

export type DiscernItem = {
  key: string;
  number: number;
  section: DiscernSection;
  question: { en: string; "pt-BR": string };
  /** Official rating hint, given to the models verbatim. */
  hint: string;
};

export const DISCERN_INSTRUMENT: readonly DiscernItem[] = [
  {
    key: "item01",
    number: 1,
    section: "reliability",
    question: { en: "Are the aims clear?", "pt-BR": "Os objetivos estão claros?" },
    hint: "Look for a clear indication at the beginning of the publication of: what it is about; what it is meant to cover (and what topics are meant to be excluded); who might find it useful. Rating note: if the answer to Question 1 is No, go directly to Question 3.",
  },
  {
    key: "item02",
    number: 2,
    section: "reliability",
    question: { en: "Does it achieve its aims?", "pt-BR": "A publicação alcança seus objetivos?" },
    hint: "Consider whether the publication provides the information it aimed to as outlined in Question 1.",
  },
  {
    key: "item03",
    number: 3,
    section: "reliability",
    question: { en: "Is it relevant?", "pt-BR": "O texto traz informações relevantes?" },
    hint: "Consider whether: the publication addresses the questions that readers might ask; recommendations and suggestions concerning treatment choices are realistic or appropriate.",
  },
  {
    key: "item04",
    number: 4,
    section: "reliability",
    question: {
      en: "Is it clear what sources of information were used to compile the publication (other than the author or producer)?",
      "pt-BR": "Está claro quais fontes de informação foram usadas para elaborar a publicação (outras além do autor ou produtor)?",
    },
    hint: "Check whether the main claims or statements made about treatment choices are accompanied by a reference to the sources used as evidence, e.g. a research study or expert opinion. Look for a means of checking the sources used such as a bibliography/reference list or the addresses of the experts or organisations quoted, or external links to the online sources. Rating note: in order to score a full 5 the publication should fulfil both hints. Lists of additional sources of support and information (Question 7) are not necessarily sources of evidence for the current publication.",
  },
  {
    key: "item05",
    number: 5,
    section: "reliability",
    question: {
      en: "Is it clear when the information used or reported in the publication was produced?",
      "pt-BR": "Está claro quando as informações usadas ou reportadas na publicação foram produzidas?",
    },
    hint: "Look for: dates of the main sources of information used to compile the publication; date of any revisions of the publication (but not dates of reprinting); date of publication (copyright date). Rating note: the hints are placed in order of importance. In order to score a full 5, the dates relating to the first hint should be found.",
  },
  {
    key: "item06",
    number: 6,
    section: "reliability",
    question: { en: "Is it balanced and unbiased?", "pt-BR": "O texto é equilibrado e imparcial?" },
    hint: "Look for: a clear indication of whether the publication is written from a personal or objective point of view; evidence that a range of sources of information was used to compile the publication, e.g. more than one research study or expert; evidence of an external assessment of the publication. Be wary if: the publication focuses on the advantages or disadvantages of one particular treatment choice without reference to other possible choices; the publication relies primarily on evidence from single cases (which may not be typical of people with this condition or of responses to a particular treatment); the information is presented in a sensational, emotive or alarmist way.",
  },
  {
    key: "item07",
    number: 7,
    section: "reliability",
    question: {
      en: "Does it provide details of additional sources of support and information?",
      "pt-BR": "O texto fornece outras fontes adicionais de suporte e informação que podem ser consultadas?",
    },
    hint: "Look for suggestions for further reading or for details of other organisations providing advice and information about the condition and treatment choices.",
  },
  {
    key: "item08",
    number: 8,
    section: "reliability",
    question: { en: "Does it refer to areas of uncertainty?", "pt-BR": "O texto aponta questões para as quais ainda não há certeza?" },
    hint: "Look for discussion of the gaps in knowledge or differences in expert opinion concerning treatment choices. Be wary if the publication implies that a treatment choice affects everyone in the same way, e.g. 100% success rate with a particular treatment.",
  },
  {
    key: "item09",
    number: 9,
    section: "treatment",
    question: { en: "Does it describe how each treatment works?", "pt-BR": "O texto descreve como funciona cada tratamento?" },
    hint: "Look for a description of how a treatment acts on the body to achieve its effect.",
  },
  {
    key: "item10",
    number: 10,
    section: "treatment",
    question: { en: "Does it describe the benefits of each treatment?", "pt-BR": "O texto descreve os benefícios de cada tratamento?" },
    hint: "Benefits can include controlling or getting rid of symptoms, preventing recurrence of the condition and eliminating the condition, both short-term and long-term.",
  },
  {
    key: "item11",
    number: 11,
    section: "treatment",
    question: { en: "Does it describe the risks of each treatment?", "pt-BR": "O texto descreve os riscos de cada tratamento?" },
    hint: "Risks can include side-effects, complications and adverse reactions to treatment, both short-term and long-term.",
  },
  {
    key: "item12",
    number: 12,
    section: "treatment",
    question: {
      en: "Does it describe what would happen if no treatment is used?",
      "pt-BR": "O texto descreve o que aconteceria caso nenhum tratamento fosse utilizado?",
    },
    hint: "Look for a description of the risks and benefits of postponing treatment, of watchful waiting (i.e. monitoring how the condition progresses without treatment) or of permanently forgoing treatment.",
  },
  {
    key: "item13",
    number: 13,
    section: "treatment",
    question: {
      en: "Does it describe how the treatment choices affect overall quality of life?",
      "pt-BR": "O texto descreve como as alternativas de tratamento afetam a qualidade de vida em geral?",
    },
    hint: "Look for: description of the effects of the treatment choices on day-to-day activity; description of the effects of the treatment choices on relationships with family, friends and carers.",
  },
  {
    key: "item14",
    number: 14,
    section: "treatment",
    question: {
      en: "Is it clear that there may be more than one possible treatment choice?",
      "pt-BR": "Fica claro que pode haver mais de uma opção de tratamento?",
    },
    hint: "Look for: a description of who is most likely to benefit from each treatment choice mentioned, and under what circumstances; suggestions of alternatives to consider or investigate further (including choices not fully described in the publication) before deciding whether to select or reject a particular treatment choice.",
  },
  {
    key: "item15",
    number: 15,
    section: "treatment",
    question: {
      en: "Does it provide support for shared decision-making?",
      "pt-BR": "O texto oferece suporte para que a decisão seja tomada de forma compartilhada?",
    },
    hint: "Look for suggestions of things to discuss with family, friends, doctors or other health professionals concerning treatment choices.",
  },
  {
    key: "item16",
    number: 16,
    section: "overall",
    question: {
      en: "Based on the answers to all of the above questions, rate the overall quality of the publication as a source of information about treatment choices.",
      "pt-BR": "Com base nas respostas para todas as perguntas acima, avalie a qualidade geral da publicação como fonte de informação sobre as alternativas de tratamento.",
    },
    hint: "1 = Low: serious or extensive shortcomings. 3 = Moderate: potentially important but not serious shortcomings. 5 = High: minimal shortcomings.",
  },
];

export const SECTION_TITLES: Record<DiscernSection, string> = {
  reliability: "Section 1 — Is the publication reliable? (questions 1-8)",
  treatment:
    "Section 2 — How good is the quality of information on treatment choices? (questions 9-15). The questions apply to the treatment (or treatments) described in the publication. Self-care is considered a form of treatment throughout this section.",
  overall: "Section 3 — Overall rating of the publication (question 16)",
};

/** Rating scale for questions 1-15; question 16 has its own anchors in its hint. */
export const RATING_SCALE =
  "Questions 1-15 are rated 1 to 5: 1 = No (the quality criterion has not been fulfilled at all); 2 to 4 = Partially (the criterion has been fulfilled to some extent; how high or low depends on the extent of the shortcomings); 5 = Yes (the criterion has been completely fulfilled).";

/** Definitions from the handbook's list of terms. The prompt gives these to every model. */
export const DISCERN_TERMS = `Treatment means a course of action adopted to deal with a health problem. It can be conventional or complementary, and includes self-care and psychological or emotional treatments.
Treatment choices are the possible options for dealing with a health problem, including treatments and no treatment (postponing treatment, watchful waiting, or permanently forgoing treatment).
Outcomes are the short-term and long-term effects of a treatment choice, including its benefits and its risks.
A publication, in this evaluation, is the text supplied below.`;

export type DiscernLocale = keyof DiscernItem["question"];

/** "N. Question" in the requested language, or the raw key when unknown. */
export function discernLabel(key: string, locale: DiscernLocale = "pt-BR"): string {
  const item = DISCERN_INSTRUMENT.find((i) => i.key === key);
  return item ? `${item.number}. ${item.question[locale]}` : key;
}

/** True when an analysis was scored against the current instrument version. */
export function isCurrentInstrument(result: { instrumentVersion?: string } | null | undefined): boolean {
  return result?.instrumentVersion === INSTRUMENT_VERSION;
}

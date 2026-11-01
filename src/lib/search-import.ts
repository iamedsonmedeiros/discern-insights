// The Google results spreadsheet produced by the Chrome collector.
// A file is recognized when it has the `tipo` and `url` columns. Only rows
// whose tipo is organic, with a real http(s) address, enter the DISCERN queue,
// and a repeated address enters once. Every other row is counted so the article
// can say how many results were collected and how many were actually screened.

import { pageKey } from "@/lib/url-key";

export type SearchHit = {
  url: string;
  page: number | null;
  /** posicao_geral: where the row sat in the search, organic or not. */
  position: number | null;
  positionOnPage: number | null;
};

export type SearchImport = {
  rows: number;
  byType: Record<string, number>;
  /** Non-organic rows only, keyed "tipo:subtipo", so "outro" can be named. */
  bySubtype: Record<string, number>;
  organicRows: number;
  uniqueOrganic: number;
  term: string | null;
  pages: number | null;
  /** Calendar day of the collection, YYYY-MM-DD. */
  collectedOn: string | null;
};

const STORAGE_KEY = "discern-search-imports";

const norm = (value: string) =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim()));
}

function delimiterOf(text: string): string {
  const line = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  const semis = (line.match(/;/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  return semis > commas ? ";" : ",";
}

function headerOf(rows: string[][]): { index: number; cols: Record<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const cols: Record<string, number> = {};
    rows[i].forEach((cell, index) => {
      const key = norm(cell);
      if (key) cols[key] = index;
    });
    if ("tipo" in cols && "url" in cols) return { index: i, cols };
  }
  return null;
}

function cleanUrl(value: string): string | null {
  const url = value.trim().replace(/[.,;:"']+$/, "");
  return /^https?:\/\//i.test(url) ? url : null;
}

/** Excel serial (1899-12-30) or an ISO day. Returns YYYY-MM-DD. */
export function collectionDay(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const serial = Number(trimmed);
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
    return date.toISOString().slice(0, 10);
  }
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

/**
 * Returns null when the rows are not the collector spreadsheet, so the caller
 * can fall back to a plain URL list.
 */
export function parseSearchRows(rows: string[][]): (SearchImport & { hits: SearchHit[]; urls: string[] }) | null {
  const header = headerOf(rows);
  if (!header) return null;

  const { cols } = header;
  const cell = (row: string[], name: string) => (cols[name] === undefined ? "" : row[cols[name]] ?? "");
  const byType: Record<string, number> = {};
  const bySubtype: Record<string, number> = {};
  const terms = new Set<string>();
  const days = new Set<string>();
  let pages = 0;
  let organicRows = 0;
  let dataRows = 0;
  const hits: SearchHit[] = [];
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const row of rows.slice(header.index + 1)) {
    const tipo = norm(cell(row, "tipo"));
    if (!tipo && !cell(row, "url").trim()) continue;
    dataRows++;
    const typeKey = tipo || "(vazio)";
    byType[typeKey] = (byType[typeKey] ?? 0) + 1;

    const term = cell(row, "termo").trim();
    if (term) terms.add(term);
    const page = Number(cell(row, "pagina"));
    if (Number.isFinite(page) && page > pages) pages = page;
    const day = collectionDay(cell(row, "coletado_em"));
    if (day) days.add(day);

    if (tipo === "organico") {
      organicRows++;
      const url = cleanUrl(cell(row, "url"));
      if (url) {
        const position = Number(cell(row, "posicao_geral"));
        const onPage = Number(cell(row, "posicao_pagina"));
        hits.push({
          url,
          page: Number.isFinite(page) && page > 0 ? page : null,
          position: Number.isFinite(position) && position > 0 ? position : null,
          positionOnPage: Number.isFinite(onPage) && onPage > 0 ? onPage : null,
        });
        const key = pageKey(url);
        if (!seen.has(key)) {
          seen.add(key);
          urls.push(url);
        }
      }
    } else {
      const sub = norm(cell(row, "subtipo")) || typeKey;
      const key = `${typeKey}:${sub}`;
      bySubtype[key] = (bySubtype[key] ?? 0) + 1;
    }
  }

  const collected = [...days].sort();
  return {
    rows: dataRows,
    byType,
    bySubtype,
    organicRows,
    uniqueOrganic: urls.length,
    term: terms.size === 1 ? [...terms][0] : terms.size > 1 ? [...terms].join("; ") : null,
    pages: pages || null,
    collectedOn: collected[0] ?? null,
    hits,
    urls,
  };
}

export function parseSearchCsv(text: string): (SearchImport & { hits: SearchHit[]; urls: string[] }) | null {
  if (!text.trim()) return null;
  return parseSearchRows(parseCsv(text, delimiterOf(text)));
}

type Locale = "pt-BR" | "en";
type Pair = [string, string];

const TIPO_LABEL: Record<string, Record<Locale, Pair>> = {
  ia: { "pt-BR": ["visão geral de IA", "visões gerais de IA"], en: ["AI overview", "AI overviews"] },
  anuncio: { "pt-BR": ["anúncio", "anúncios"], en: ["advertisement", "advertisements"] },
  mapa: { "pt-BR": ["mapa", "mapas"], en: ["map", "maps"] },
  outro: { "pt-BR": ["outro bloco", "outros blocos"], en: ["other block", "other blocks"] },
};

const SUBTIPO_LABEL: Record<string, Record<Locale, Pair>> = {
  paa: { "pt-BR": ['bloco "as pessoas também perguntam"', 'blocos "as pessoas também perguntam"'], en: ['"people also ask" block', '"people also ask" blocks'] },
  video: { "pt-BR": ["vídeo", "vídeos"], en: ["video", "videos"] },
  buscas_relacionadas: { "pt-BR": ["busca relacionada", "buscas relacionadas"], en: ["related search", "related searches"] },
  ia_parcial: { "pt-BR": ["visão geral de IA", "visões gerais de IA"], en: ["AI overview", "AI overviews"] },
  snippet: { "pt-BR": ["trecho em destaque", "trechos em destaque"], en: ["featured snippet", "featured snippets"] },
  noticia: { "pt-BR": ["notícia", "notícias"], en: ["news item", "news items"] },
  imagens: { "pt-BR": ["bloco de imagens", "blocos de imagens"], en: ["image block", "image blocks"] },
  discussoes: { "pt-BR": ["discussão", "discussões"], en: ["discussion", "discussions"] },
  shopping: { "pt-BR": ["shopping", "shopping"], en: ["shopping block", "shopping blocks"] },
};

const counted = (count: number, locale: Locale, key: string, table: Record<string, Record<Locale, Pair>>) => {
  const pair = table[key]?.[locale] ?? [key, key];
  return `${count} ${count === 1 ? pair[0] : pair[1]}`;
};

function joinList(parts: string[], locale: Locale): string {
  if (parts.length <= 1) return parts[0] ?? "";
  const and = locale === "pt-BR" ? "e" : "and";
  return `${parts.slice(0, -1).join(", ")} ${and} ${parts[parts.length - 1]}`;
}

function formatDay(iso: string, locale: Locale): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function leftOutPhrase(entry: SearchImport, locale: Locale): string {
  const leftOut = entry.rows - entry.organicRows;
  if (leftOut <= 0) return "";
  const parts: string[] = [];
  for (const [tipo, count] of Object.entries(entry.byType)) {
    if (tipo === "organico") continue;
    if (tipo === "outro") {
      const subs = Object.entries(entry.bySubtype)
        .filter(([key]) => key.startsWith("outro:"))
        .map(([key, n]) => counted(n, locale, key.slice("outro:".length), SUBTIPO_LABEL));
      parts.push(...(subs.length ? subs : [counted(count, locale, "outro", TIPO_LABEL)]));
    } else {
      parts.push(counted(count, locale, tipo, TIPO_LABEL));
    }
  }
  const named = parts.length ? `: ${joinList(parts, locale)}` : "";
  return locale === "pt-BR"
    ? ` Os outros ${leftOut} resultados não foram analisados${named}.`
    : ` The other ${leftOut} results were not analyzed${named}.`;
}

/** One sentence per imported spreadsheet, for the methods section. */
export function describeSearchImports(imports: SearchImport[], locale: Locale): string {
  return imports
    .map((entry) => {
      const when = entry.collectedOn ? formatDay(entry.collectedOn, locale) : null;
      if (locale === "pt-BR") {
        const where = [
          entry.pages ? `em ${entry.pages} páginas de resultado` : "",
          when ? `em ${when}` : "",
          entry.term ? `para o termo "${entry.term}"` : "",
        ].filter(Boolean).join(", ");
        return `A planilha de coleta registrou ${entry.rows} resultados${where ? ` ${where}` : ""}. Desses, ${entry.organicRows} eram resultados orgânicos (${entry.uniqueOrganic} endereços únicos), mantidos na ordem em que apareceram. Cada endereço é analisado só na primeira posição; quando volta a aparecer, a mesma nota é repetida e não entra de novo na média.${leftOutPhrase(entry, locale)}`;
      }
      const where = [
        entry.pages ? `across ${entry.pages} result pages` : "",
        when ? `on ${when}` : "",
        entry.term ? `for the query "${entry.term}"` : "",
      ].filter(Boolean).join(", ");
      return `The collection spreadsheet recorded ${entry.rows} results${where ? ` ${where}` : ""}. Of these, ${entry.organicRows} were organic results (${entry.uniqueOrganic} unique addresses), kept in the order they appeared. Each address is analyzed only at its first position; later positions repeat that score and are left out of the mean.${leftOutPhrase(entry, locale)}`;
    })
    .join(" ");
}

export function loadSearchImports(): SearchImport[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function rememberSearchImport(entry: SearchImport): SearchImport[] {
  const next = [...loadSearchImports(), entry];
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function clearSearchImports(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

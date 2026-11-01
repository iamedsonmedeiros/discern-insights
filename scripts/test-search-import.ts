import { readFileSync } from "node:fs";
import { collectionDay, describeSearchImports, parseSearchCsv, parseSearchRows } from "../src/lib/search-import";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const csv = [
  "termo;pagina;tipo;subtipo;url;coletado_em",
  "câncer de pele;1;ia;ia_parcial;;46321.76",
  "câncer de pele;1;organico;;https://www.sbd.org.br/doencas/cancer-da-pele/;46321.76",
  "câncer de pele;1;organico;;https://www.sbd.org.br/doencas/cancer-da-pele/;46321.76",
  "câncer de pele;1;outro;video;https://www.youtube.com/watch?v=1;46321.76",
  "câncer de pele;2;organico;;https://www.gov.br/saude;46321.76",
].join("\n");

const parsed = parseSearchCsv(csv);
assert(parsed, "csv recognized");
assert(parsed!.rows === 5, `rows ${parsed!.rows}`);
assert(parsed!.organicRows === 3, `organic rows ${parsed!.organicRows}`);
assert(parsed!.uniqueOrganic === 2, `unique ${parsed!.uniqueOrganic}`);
assert(parsed!.hits.length === 3, `hits ${parsed!.hits.length}`);
assert(parsed!.hits[0].url === parsed!.hits[1].url, "duplicate stays in order");
assert(parsed!.hits[2].url.includes("gov.br"), "third hit is the next position");
assert(parsed!.urls[0].includes("sbd.org.br"), "first organic kept");
assert(!parsed!.urls.some((url) => url.includes("youtube")), "video stayed out");
assert(parsed!.pages === 2, `pages ${parsed!.pages}`);
assert(parsed!.collectedOn === "2026-10-26", `day ${parsed!.collectedOn}`);
assert(parsed!.term === "câncer de pele", "term");
assert(collectionDay("46321.763194444444") === "2026-10-26", "excel serial");
assert(parseSearchCsv("https://exemplo.com/a\nhttps://exemplo.com/b") === null, "plain urls are not a spreadsheet");

const sentence = describeSearchImports([parsed!], "pt-BR");
assert(sentence.includes("5 resultados"), sentence);
assert(sentence.includes("3 eram resultados orgânicos"), sentence);
assert(sentence.includes("2 endereços únicos"), sentence);
assert(sentence.includes("primeira posição"), sentence);
assert(sentence.includes("youtube") === false, "sentence must not list excluded urls");
assert(sentence.includes("visão geral de IA"), sentence);
assert(sentence.includes("vídeo"), sentence);

const xlsxPath = "/Users/edsonmedeiros/Downloads/Cópia de busca-google-cancer-de-pele-20261026-1824.xlsx";
try {
  const XLSX = require("xlsx") as typeof import("xlsx");
  const book = XLSX.read(readFileSync(xlsxPath), { type: "buffer" });
  const sheet = book.Sheets[book.SheetNames[0]];
  const rows = (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" }) as unknown[][])
    .map((row) => row.map((cell) => (cell == null ? "" : String(cell))));
  const real = parseSearchRows(rows);
  assert(real, "xlsx recognized");
  assert(real!.rows === 153, `xlsx rows ${real!.rows}`);
  assert(real!.organicRows === 147, `xlsx organic ${real!.organicRows}`);
  assert(real!.uniqueOrganic === 86, `xlsx unique ${real!.uniqueOrganic}`);
  assert(real!.hits.length === 147, `xlsx hits ${real!.hits.length}`);
  assert(real!.hits[0].position === 4, `first position ${real!.hits[0].position}`);
  assert(real!.hits[0].page === 1, "first hit is page 1");
  assert(real!.pages === 15, `xlsx pages ${real!.pages}`);
  assert(real!.collectedOn === "2026-10-26", `xlsx day ${real!.collectedOn}`);
  assert(real!.urls[0] === "https://www.sbd.org.br/doencas/cancer-da-pele/", "first url");
  assert(!real!.urls.includes("https://www.youtube.com/watch?v=23NtMP09YJo"), "video block stayed out");
  assert(real!.urls.some((url) => url.includes("youtube.com")), "organic youtube links stay for eligibility");
  assert(real!.urls.some((url) => url.includes("facebook.com")), "organic facebook kept for later eligibility");
  const realSentence = describeSearchImports([real!], "pt-BR");
  assert(realSentence.includes("2 blocos"), realSentence);
  assert(realSentence.includes("86 endereços únicos"), realSentence);
  console.log(realSentence);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") console.log("xlsx check skipped: file not found");
  else throw error;
}

console.log("search import tests passed");

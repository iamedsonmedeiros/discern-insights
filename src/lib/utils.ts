
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { type AnalysisItem, type AnalysisStatus } from "./types";
import { getReportedScores, shortModelName } from "./reported-scores";
import { discernLabel, isCurrentInstrument } from "./discern-items";
import type { ModelResultRow } from "@/app/actions";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak, AlignmentType, Table, TableRow, TableCell, TableLayoutType, WidthType } from 'docx';
import { saveAs } from 'file-saver';


export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export function extractUrlsFromString(content: string): string[] {
    if (!content) {
        return [];
    }

    // DEBUG: Log raw content info
    const lines = content.split(/\n/);
    console.log(`[extractUrls] Raw content length: ${content.length} chars, ${lines.length} lines`);
    console.log(`[extractUrls] First 3 lines:`, lines.slice(0, 3));
    console.log(`[extractUrls] Last 3 lines:`, lines.slice(-3));

    // Use a regex to directly find all URLs (http/https) in the content
    const httpMatches = content.match(/https?:\/\/[^\s,;|"'\t\n]+/g) || [];
    console.log(`[extractUrls] Direct URL regex matches: ${httpMatches.length}`);

    // Also find bare domain tokens (without http)
    const tokens = content.split(/[\s,;|"\n\t]+/).filter(Boolean);
    console.log(`[extractUrls] Total tokens after split: ${tokens.length}`);

    const bareDomainUrls = tokens
        .map(token => token.trim())
        .filter(token => {
            // Must not already start with http (those are captured above)
            if (token.startsWith('http')) return false;
            // Must look like a domain: has a dot, has letters, not just a number
            return token.includes('.') && !token.startsWith('.') && !token.endsWith('.') && /[a-zA-Z]/.test(token) && token.length > 4;
        })
        .map(token => 'https://' + token);

    console.log(`[extractUrls] Bare domain URLs found: ${bareDomainUrls.length}`);

    // Combine both sets
    const combined = [...httpMatches, ...bareDomainUrls];

    // Clean up trailing punctuation
    const finalizedUrls = combined.map(url => {
        return url.replace(/[.,;:"']+$/, '');
    }).filter(url => url.length > 8);

    console.log(`[extractUrls] Final URLs: ${finalizedUrls.length}`);

    return finalizedUrls;
}


export function exportJson(data: AnalysisItem[], filename: string) {
    const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(data, null, 2))}`;
    const link = document.createElement('a');
    link.href = jsonString;
    link.download = `${filename}.json`;
    link.click();
}

function escapeCsvField(field: any): string {
    if (field === null || field === undefined) {
        return '';
    }
    const stringField = String(field);
    if (stringField.includes(',') || stringField.includes('"') || stringField.includes('\n')) {
        return `"${stringField.replace(/"/g, '""')}"`;
    }
    return stringField;
}

const instrumentVersionOf = (item: AnalysisItem) =>
    item.discernResult ? item.discernResult.instrumentVersion ?? 'legacy' : '';

export function exportCsv(data: AnalysisItem[], filename: string) {
    if (data.length === 0) return;

    const discernItemHeaders = Array.from({ length: 16 }, (_, i) => `item${String(i + 1).padStart(2, '0')}_score`);

    const headers = [
        'index', 'url', 'status', 'reason', 'title', 'instrument_version',
        'score_geral', 'confiabilidade_avg', 'qualidade_tratamento_avg',
        ...discernItemHeaders,
        'resumo_executivo', 'observacoes', 'recomendacoes'
    ];

    const rows = data.map(item => {
        const discernScores = discernItemHeaders.map(header => {
            const key = header.replace('_score', '') as keyof NonNullable<AnalysisItem['discernResult']>['scores'];
            const value = item.discernResult?.scores?.[key];
            return escapeCsvField(value === null ? "NA" : value);
        });

        return [
            escapeCsvField(item.index),
            escapeCsvField(item.url),
            escapeCsvField(item.status),
            escapeCsvField(item.reason),
            escapeCsvField(item.meta?.title),
            escapeCsvField(instrumentVersionOf(item)),
            escapeCsvField(item.discernResult?.domainAverages.score_geral),
            escapeCsvField(item.discernResult?.domainAverages.confiabilidade),
            escapeCsvField(item.discernResult?.domainAverages.qualidade_tratamento),
            ...discernScores,
            escapeCsvField(item.discernResult?.resumo),
            escapeCsvField(item.discernResult?.observacoes),
            escapeCsvField(item.discernResult?.recommmendacoes),
        ].join(',');
    });


    const csvString = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([`\uFEFF${csvString}`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

export function exportScoreSheetCsv(data: AnalysisItem[], filename: string) {
    if (data.length === 0) return;

    const discernItemHeaders = Array.from({ length: 16 }, (_, i) => `Item ${i + 1}`);

    const headers = [
        'URL',
        ...discernItemHeaders,
        'Média Geral'
    ];

    const rows = data.map(item => {
        const scores = Array.from({ length: 16 }, (_, i) => {
            const key = `item${String(i + 1).padStart(2, '0')}` as keyof NonNullable<AnalysisItem['discernResult']>['scores'];
            const value = item.discernResult?.scores?.[key];
            return value === null ? "NA" : value || '';
        });

        return [
            escapeCsvField(item.url),
            ...scores,
            escapeCsvField(item.discernResult?.domainAverages.score_geral),
        ].join(',');
    });

    const csvString = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([`\uFEFF${csvString}`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/**
 * Long-format consensus export: one row per (URL x DISCERN item), with each
 * model's raw score in its own column alongside the consensus statistics.
 *
 * Long format rather than wide because this is the shape statistical software
 * expects for inter-rater analysis — it can be fed straight into an ICC or
 * Krippendorff routine without reshaping.
 */
export function exportConsensusCsv(data: AnalysisItem[], filename: string) {
    const withConsensus = data.filter(item => item.consensus);
    if (withConsensus.length === 0) return;

    // Union of every model seen, so the column layout is stable across rows even
    // when a model failed on some pages.
    const models = Array.from(
        new Set(withConsensus.flatMap(item => item.consensus!.models))
    ).sort();

    const headers = [
        'url', 'title', 'instrument_version', 'item', 'question',
        'consensus_mean', 'sd', 'min', 'max', 'range', 'diverged',
        ...models.map(m => `score_${m}`),
    ];

    const rows: string[] = [];

    for (const item of withConsensus) {
        const consensus = item.consensus!;
        for (let i = 1; i <= 16; i++) {
            const key = `item${String(i).padStart(2, '0')}`;
            const stat = consensus.perItem[key];
            if (!stat) continue;

            rows.push([
                escapeCsvField(item.url),
                escapeCsvField(item.meta?.title),
                escapeCsvField(instrumentVersionOf(item)),
                escapeCsvField(key),
                escapeCsvField(discernLabel(key)),
                escapeCsvField(stat.mean),
                escapeCsvField(stat.sd),
                escapeCsvField(stat.min),
                escapeCsvField(stat.max),
                escapeCsvField(stat.range),
                escapeCsvField(stat.range > 1 ? 'yes' : 'no'),
                ...models.map(m => escapeCsvField(stat.values[m] ?? '')),
            ].join(','));
        }
    }

    const csvString = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([`\uFEFF${csvString}`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}


const statusTranslations: Record<AnalysisStatus, string> = {
    pending: 'Pendente',
    processing: 'Processando',
    completed: 'Concluído',
    not_eligible_pdf: 'Não Elegível (PDF)',
    not_eligible_video: 'Não Elegível (Vídeo)',
    not_eligible_social: 'Não Elegível (Rede Social)',
    unavailable_offline: 'Offline / Indisponível',
    scraping_error: 'Erro de Extração',
    analysis_error: 'Erro de Análise',
};


/**
 * `loadModelResults` supplies each model's own justifications for items where the
 * panel diverged; they aren't stored on the item. Without it, only the narrative
 * model's justification is exported.
 */
export async function exportDocx(
    data: AnalysisItem[],
    filename: string,
    loadModelResults?: (itemId: string) => Promise<ModelResultRow[]>
) {
    if (data.length === 0) return;

    const modelResults = new Map<string, ModelResultRow[]>();
    if (loadModelResults) {
        const divergent = data.filter(item => item.status === 'completed' && item.divergenceFlag);
        const loaded = await Promise.all(divergent.map(item => loadModelResults(item.id).catch(() => [])));
        divergent.forEach((item, i) => modelResults.set(item.id, loaded[i]));
    }

    const doc = new Document({
        sections: [{
            properties: {},
            children: data.flatMap((item, index) => {
                const children: Paragraph[] = [
                    new Paragraph({
                        text: `${index + 1}. ${item.meta?.title || item.url}`,
                        heading: HeadingLevel.HEADING_1,
                    }),
                    new Paragraph({
                        children: [new TextRun({ text: item.url, style: "Hyperlink" })],
                    }),
                ];

                const reported = getReportedScores(item);

                if (item.discernResult && reported) {
                    const consensus = item.consensus;
                    const narrativeModel = reported.narrativeModel ? shortModelName(reported.narrativeModel) : null;

                    children.push(
                        new Paragraph({ text: `Análise concluída em: ${new Date(item.updatedAt).toLocaleString()}`, style: 'Emphasis' }),
                        ...(isCurrentInstrument(item.discernResult) ? [] : [new Paragraph({
                            children: [new TextRun({
                                text: 'Atenção: análise feita com a versão anterior das perguntas, que não correspondia ao DISCERN oficial (sem o item 10, "benefícios", e com a pergunta sobre opções repetida). As notas abaixo não são comparáveis com as análises atuais. Reprocesse a URL para obter uma avaliação fiel ao instrumento.',
                                bold: true,
                                color: "B45309",
                            })]
                        })]),
                        new Paragraph({ text: " " }),

                        new Paragraph({ text: "Métricas Principais", heading: HeadingLevel.HEADING_2 }),
                    );

                    if (consensus) {
                        children.push(new Paragraph({
                            children: [new TextRun({
                                text: `Médias do painel de ${consensus.models.length} modelos (${consensus.models.map(shortModelName).join(", ")}).`,
                                italics: true,
                            })]
                        }));
                        if (item.panelIncomplete) {
                            children.push(new Paragraph({
                                children: [new TextRun({
                                    text: `Painel incompleto: ${consensus.models.length} de ${item.modelsTotal ?? "?"} modelos concluíram a avaliação.`,
                                    italics: true,
                                    color: "B45309",
                                })]
                            }));
                        }
                    }

                    children.push(
                        new Paragraph({
                            children: [
                                new TextRun({ text: "Confiabilidade: ", bold: true }),
                                new TextRun(reported.domainAverages.confiabilidade.toFixed(2)),
                            ]
                        }),
                        new Paragraph({
                            children: [
                                new TextRun({ text: "Qualidade do Tratamento: ", bold: true }),
                                new TextRun(reported.domainAverages.qualidade_tratamento.toFixed(2)),
                            ]
                        }),
                        new Paragraph({
                            children: [
                                new TextRun({ text: "Score Geral: ", bold: true }),
                                new TextRun(reported.domainAverages.score_geral.toFixed(2)),
                            ]
                        }),
                        new Paragraph({ text: " " }),
                    );

                    if (consensus) {
                        children.push(new Paragraph({
                            children: [new TextRun({
                                text: narrativeModel
                                    ? `Narrativa: ${narrativeModel}. Resumo, observações, recomendações e justificativas são o texto deste modelo; as notas acima são a média do painel.`
                                    : "Narrativa: modelo primário. Resumo, observações, recomendações e justificativas são o texto deste modelo; as notas acima são a média do painel.",
                                italics: true,
                            })]
                        }));
                    }

                    children.push(
                        new Paragraph({ text: "Resumo Executivo", heading: HeadingLevel.HEADING_2 }),
                        new Paragraph(item.discernResult.resumo),
                        new Paragraph({ text: " " }),

                        new Paragraph({ text: "Observações", heading: HeadingLevel.HEADING_2 }),
                        new Paragraph(item.discernResult.observacoes),
                        new Paragraph({ text: " " }),

                        new Paragraph({ text: "Recomendações", heading: HeadingLevel.HEADING_2 }),
                        new Paragraph(item.discernResult.recommmendacoes),
                        new Paragraph({ text: " " }),

                        new Paragraph({ text: "Análise Detalhada dos Itens", heading: HeadingLevel.HEADING_2 }),
                    );

                    const primaryJustifications = item.discernResult.justifications as Record<string, string>;
                    const panelRows = modelResults.get(item.id) ?? [];

                    Object.keys(reported.scores).sort().forEach((key) => {
                        const question = discernLabel(key);
                        const stat = consensus?.perItem[key];
                        const diverged = !!stat && stat.range > 1;

                        children.push(new Paragraph({
                            children: [new TextRun({ text: question, bold: true })]
                        }));

                        if (stat) {
                            const perModel = consensus!.models
                                .map((model) => `${shortModelName(model)}: ${stat.values[model] ?? "não avaliado"}`)
                                .join(" · ");
                            children.push(new Paragraph({
                                children: [
                                    new TextRun({ text: `Média do painel: ${stat.mean ?? "não avaliado"}${stat.mean == null ? "" : "/5"} (${perModel})` }),
                                    ...(diverged ? [new TextRun({ text: `  DIVERGENTE (amplitude ${stat.range})`, bold: true, color: "B45309" })] : []),
                                ]
                            }));
                        } else {
                            children.push(new Paragraph({
                                children: [new TextRun({ text: reported.scores[key] == null ? "Score: não avaliado" : `Score: ${reported.scores[key]}/5` })]
                            }));
                        }

                        children.push(new Paragraph({
                            children: [
                                new TextRun({ text: narrativeModel && consensus ? `Justificativa (${narrativeModel}): ` : "Justificativa: ", italics: true }),
                                new TextRun({ text: primaryJustifications[key], italics: true }),
                            ]
                        }));

                        if (diverged) {
                            for (const row of panelRows) {
                                if (row.status !== "done" || row.modelId === reported.narrativeModel) continue;
                                const text = row.justifications?.[key];
                                if (!text) continue;
                                children.push(new Paragraph({
                                    children: [
                                        new TextRun({ text: `Justificativa (${shortModelName(row.modelId)}, nota ${row.scores?.[key] ?? "?"}): `, italics: true }),
                                        new TextRun({ text, italics: true }),
                                    ]
                                }));
                            }
                        }

                        children.push(new Paragraph({ text: " " }));
                    });
                } else {
                    children.push(
                        new Paragraph({ text: " " }),
                        new Paragraph({
                            children: [
                                new TextRun({ text: "Status: ", bold: true }),
                                new TextRun({ text: statusTranslations[item.status] || item.status, color: "FF0000" }),
                            ],
                        }),
                        new Paragraph({
                            children: [
                                new TextRun({ text: "Motivo: ", bold: true }),
                                new TextRun(item.reason || "Nenhum motivo especificado."),
                            ],
                        }),
                        new Paragraph({ text: " " }),
                        new Paragraph({
                            children: [
                                new TextRun({ text: "A análise automatizada não pôde ser concluída. Recomenda-se uma verificação e análise manual deste item.", bold: true, italics: true }),
                            ]
                        })
                    );
                }

                if (index < data.length - 1) {
                    children.push(new Paragraph({ children: [new PageBreak()] }));
                }

                return children;
            }),
        }],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `${filename}.docx`);
}


/** "**Objective:** text" → a bold run followed by a plain one. */
function inlineRuns(line: string): TextRun[] {
    return line
        .split(/(\*\*[^*]+\*\*)/g)
        .filter(Boolean)
        .map(part => part.startsWith('**') && part.endsWith('**')
            ? new TextRun({ text: part.slice(2, -2), bold: true })
            : new TextRun({ text: part.replace(/\*\*/g, '') }));
}

const tableCells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

// A4 content width: 11906 DXA minus 2 cm margins on each side. Pages ignores a
// percentage table width and collapses the columns, so the widths are fixed.
const PAGE_CONTENT_DXA = 11906 - 1134 * 2;
const TABLE_COLUMN_DXA = [PAGE_CONTENT_DXA - 2600, 1900, 700];

function markdownTable(lines: string[]): Table {
    const rows = lines
        .filter(line => !/^\|?\s*:?-{3,}/.test(line.trim()))
        .map(tableCells);
    const columns = rows[0]?.length ?? TABLE_COLUMN_DXA.length;
    const widths = columns === TABLE_COLUMN_DXA.length
        ? TABLE_COLUMN_DXA
        : Array.from({ length: columns }, () => Math.floor(PAGE_CONTENT_DXA / columns));
    return new Table({
        width: { size: PAGE_CONTENT_DXA, type: WidthType.DXA },
        columnWidths: widths,
        layout: TableLayoutType.FIXED,
        rows: rows.map((cells, rowIndex) => new TableRow({
            tableHeader: rowIndex === 0,
            children: cells.map((cell, column) => new TableCell({
                width: { size: widths[column] ?? widths[widths.length - 1], type: WidthType.DXA },
                margins: { top: 40, bottom: 40, left: 80, right: 80 },
                children: [new Paragraph({ children: [new TextRun({ text: cell, bold: rowIndex === 0, size: 20 })] })],
            })),
        })),
    });
}

function createSection(text: string): (Paragraph | Table)[] {
    const blocks: (Paragraph | Table)[] = [];
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('|')) {
            const tableLines: string[] = [];
            while (i < lines.length && lines[i].trim().startsWith('|')) tableLines.push(lines[i++]);
            i--;
            blocks.push(markdownTable(tableLines));
            continue;
        }

        const heading = (prefix: number) => line.substring(prefix).replace(/\*\*/g, '');
        if (line.startsWith('### ')) {
            blocks.push(new Paragraph({ text: heading(4), heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 100 } }));
        } else if (line.startsWith('## ')) {
            blocks.push(new Paragraph({ text: heading(3), heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } }));
        } else if (line.startsWith('# ')) {
            blocks.push(new Paragraph({ text: heading(2), heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 150 } }));
        } else if (line.trim() === '') {
            blocks.push(new Paragraph({ text: '' }));
        } else {
            blocks.push(new Paragraph({
                children: inlineRuns(line),
                spacing: { after: 100 },
                alignment: AlignmentType.JUSTIFIED
            }));
        }
    }
    return blocks;
}


export async function saveDocxFromContent(content: string, filename: string) {
    // Only a line holding nothing but "---" separates sections; table rules ("| --- |") must survive.
    const sections = content.split(/^\s*---\s*$/m).map(s => s.trim());
    const docChildren = sections.flatMap(section => createSection(section));

    const doc = new Document({
        styles: {
            default: {
                document: {
                    run: {
                        font: "Arial",
                        size: 24, // 12pt
                    },
                },
            },
        },
        sections: [{
            properties: {
                page: {
                    size: { width: 11906, height: 16838 },
                    margin: {
                        top: 1134, // ~2cm
                        right: 1134,
                        bottom: 1134,
                        left: 1134,
                    },
                },
            },
            children: docChildren.map(block => {
                if (block instanceof Paragraph) (block as any).spacing = { line: 360, before: 0, after: 0 };
                return block;
            }),
        }],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `${filename}.docx`);
}

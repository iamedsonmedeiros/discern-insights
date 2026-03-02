
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { type AnalysisItem, type AnalysisStatus } from "./types";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak, AlignmentType, Level, Indent, Numbering, AbstractNumbering } from 'docx';
import { saveAs } from 'file-saver';


export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function extractUrlsFromString(content: string): string[] {
  if (!content) {
    return [];
  }
  
  const lines = content.split(/[\r\n]+/);
  
  const urls = lines
    .map(line => line.trim())
    .filter(line => line.startsWith('http://') || line.startsWith('https://'));
    
  // Deduplicate and return
  return [...new Set(urls)];
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

export function exportCsv(data: AnalysisItem[], filename: string) {
  if (data.length === 0) return;

  const discernItemHeaders = Array.from({ length: 16 }, (_, i) => `item${String(i + 1).padStart(2, '0')}_score`);

  const headers = [
    'index', 'url', 'status', 'reason', 'title',
    'score_geral', 'confiabilidade_avg', 'qualidade_tratamento_avg',
    ...discernItemHeaders,
    'resumo_executivo', 'observacoes', 'recomendacoes'
  ];
  
  const rows = data.map(item => {
    const discernScores = discernItemHeaders.map(header => {
        const key = header.replace('_score', '') as keyof NonNullable<AnalysisItem['discernResult']>['scores'];
        return escapeCsvField(item.discernResult?.scores?.[key]);
    });

    return [
      escapeCsvField(item.index),
      escapeCsvField(item.url),
      escapeCsvField(item.status),
      escapeCsvField(item.reason),
      escapeCsvField(item.meta?.title),
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

const discernQuestions: Record<string, string> = {
    'item01': '1. Os objetivos são claros?',
    'item02': '2. A publicação atinge seus objetivos?',
    'item03': '3. É relevante?',
    'item04': '4. Cita explicitamente as fontes de evidência?',
    'item05': '5. A data das fontes é clara?',
    'item06': '6. É equilibrada e imparcial?',
    'item07': '7. Aponta áreas de incerteza?',
    'item08': '8. Descreve como o tratamento funciona?',
    'item09': '9. Descreve os riscos do tratamento?',
    'item10': '10. Descreve os efeitos colaterais?',
    'item11': '11. Descreve o que aconteceria sem tratamento?',
    'item12': '12. Discute como o tratamento afeta a qualidade de vida?',
    'item13': '13. Deixa claro que existem outras opções?',
    'item14': '14. Oferece suporte para decisão compartilhada?',
    'item15': '15. Há mais de uma opção de tratamento?',
    'item16': '16. Avaliação geral da qualidade'
};


const statusTranslations: Record<AnalysisStatus, string> = {
  pending: 'Pendente',
  processing: 'Processando',
  completed: 'Concluído',
  not_eligible_pdf: 'Não Elegível (PDF)',
  not_eligible_video: 'Não Elegível (Vídeo)',
  unavailable_offline: 'Offline / Indisponível',
  scraping_error: 'Erro de Extração',
  analysis_error: 'Erro de Análise',
};


export async function exportDocx(data: AnalysisItem[], filename: string) {
    if (data.length === 0) return;

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

                if (item.discernResult) {
                    children.push(
                        new Paragraph({ text: `Análise concluída em: ${new Date(item.updatedAt).toLocaleString()}`, style: 'Emphasis' }),
                        new Paragraph({ text: " " }),

                        new Paragraph({ text: "Métricas Principais", heading: HeadingLevel.HEADING_2 }),
                        new Paragraph({
                            children: [
                                new TextRun({ text: "Confiabilidade: ", bold: true }),
                                new TextRun(item.discernResult.domainAverages.confiabilidade.toFixed(2)),
                            ]
                        }),
                        new Paragraph({
                            children: [
                                new TextRun({ text: "Qualidade do Tratamento: ", bold: true }),
                                new TextRun(item.discernResult.domainAverages.qualidade_tratamento.toFixed(2)),
                            ]
                        }),
                        new Paragraph({
                            children: [
                                new TextRun({ text: "Score Geral: ", bold: true }),
                                new TextRun(item.discernResult.domainAverages.score_geral.toFixed(2)),
                            ]
                        }),
                        new Paragraph({ text: " " }),

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
                    
                    Object.entries(item.discernResult.scores).sort(([a], [b]) => a.localeCompare(b)).forEach(([key, score]) => {
                        children.push(new Paragraph({
                            children: [ new TextRun({ text: discernQuestions[key] || key, bold: true }) ]
                        }));
                        children.push(new Paragraph({
                            children: [ new TextRun({ text: `Score: ${score}/5` }) ]
                        }));
                        children.push(new Paragraph({
                            children: [
                                new TextRun({ text: "Justificativa: ", italics: true }),
                                new TextRun({ text: item.discernResult!.justifications[key], italics: true }),
                            ]
                        }));
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


function createSection(text: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const lines = text.split('\n');
  let currentHeadingLevel: HeadingLevel | undefined = undefined;

  for (const line of lines) {
    if (line.startsWith('### ')) {
      paragraphs.push(new Paragraph({ text: line.substring(4), heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 100 } }));
      currentHeadingLevel = HeadingLevel.HEADING_3;
    } else if (line.startsWith('## ')) {
      paragraphs.push(new Paragraph({ text: line.substring(3), heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } }));
      currentHeadingLevel = HeadingLevel.HEADING_2;
    } else if (line.startsWith('# ')) {
      paragraphs.push(new Paragraph({ text: line.substring(2), heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 150 } }));
      currentHeadingLevel = HeadingLevel.HEADING_1;
    } else if (line.trim() === '') {
      paragraphs.push(new Paragraph({ text: '' }));
    } else {
        const isBold = line.startsWith('**') && line.endsWith('**');
        const cleanLine = line.replace(/\*\*/g, '');
        paragraphs.push(new Paragraph({ 
            children: [new TextRun({ text: cleanLine, bold: isBold })],
            spacing: { after: 100 }, 
            alignment: AlignmentType.JUSTIFIED 
        }));
    }
  }
  return paragraphs;
}


export async function saveDocxFromContent(content: string, filename: string) {
    const sections = content.split('---').map(s => s.trim());
    const docChildren: Paragraph[] = sections.flatMap(section => createSection(section));

    const doc = new Document({
        styles: {
            paragraph: {
                run: {
                    font: "Arial",
                    size: 24, // 12pt
                },
            },
        },
        sections: [{
             properties: {
                page: {
                    margin: {
                        top: 1134, // ~2cm
                        right: 1134,
                        bottom: 1134,
                        left: 1134,
                    },
                },
            },
            children: docChildren.map(p => {
                p.properties.spacing = { line: 360, before: 0, after: 0 }; // Double spacing
                return p;
            }),
        }],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `${filename}.docx`);
}

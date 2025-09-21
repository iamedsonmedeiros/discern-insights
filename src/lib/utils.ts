import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { type AnalysisItem } from "./types";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } from 'docx';
import { saveAs } from 'file-saver';


export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function parseCsv(content: string): string[] {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) return [];
  
  const headerLine = lines.find(line => line.trim() !== '');
  if (!headerLine) return [];

  const header = headerLine.split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());
  let urlIndex = header.indexOf('url');
  if (urlIndex === -1) {
    urlIndex = 0; // Assume first column if 'url' header not found
  }
  
  return lines
    .map(line => {
      const values = line.split(',');
      return values[urlIndex]?.trim().replace(/"/g, '');
    })
    .filter(url => url && (url.startsWith('http://') || url.startsWith('https://')));
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
    'index', 'url', 'status', 'motivo', 'titulo',
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

export async function exportDocx(data: AnalysisItem[], filename: string) {
    if (data.length === 0) return;

    const doc = new Document({
        sections: [{
            properties: {},
            children: data.flatMap(item => {
                if (!item.discernResult) return [];

                const children = [
                    new Paragraph({
                        text: item.meta?.title || item.url,
                        heading: HeadingLevel.HEADING_1,
                    }),
                    new Paragraph({
                        children: [new TextRun({ text: item.url, style: "Hyperlink" })],
                    }),
                    new Paragraph({ text: `Análise concluída em: ${new Date(item.updatedAt).toLocaleString()}`, style: 'Emphasis' }),
                    new Paragraph({ text: " " }),

                    new Paragraph({ text: "Métricas Principais", heading: HeadingLevel.HEADING_2 }),
                    new Table({
                        width: { size: 100, type: WidthType.PERCENTAGE },
                        rows: [
                            new TableRow({
                                children: [
                                    new TableCell({ children: [new Paragraph("Confiabilidade")], width: { size: 33, type: WidthType.PERCENTAGE } }),
                                    new TableCell({ children: [new Paragraph("Qualidade do Tratamento")], width: { size: 33, type: WidthType.PERCENTAGE } }),
                                    new TableCell({ children: [new Paragraph("Score Geral")], width: { size: 34, type: WidthType.PERCENTAGE } }),
                                ],
                            }),
                            new TableRow({
                                children: [
                                    new TableCell({ children: [new Paragraph(item.discernResult.domainAverages.confiabilidade.toFixed(2))] }),
                                    new TableCell({ children: [new Paragraph(item.discernResult.domainAverages.qualidade_tratamento.toFixed(2))] }),
                                    new TableCell({ children: [new Paragraph(item.discernResult.domainAverages.score_geral.toFixed(2))] }),
                                ],
                            }),
                        ],
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
                ];

                const tableRows = Object.entries(item.discernResult.scores).map(([key, score]) => {
                     return new TableRow({
                        children: [
                            new TableCell({
                                children: [new Paragraph(discernQuestions[key] || key)],
                                width: { size: 40, type: WidthType.PERCENTAGE },
                            }),
                            new TableCell({
                                children: [new Paragraph(String(score))],
                                width: { size: 10, type: WidthType.PERCENTAGE },
                            }),
                            new TableCell({
                                children: [new Paragraph(item.discernResult!.justifications[key])],
                                width: { size: 50, type: WidthType.PERCENTAGE },
                            }),
                        ],
                    });
                });
                
                const headerRow = new TableRow({
                    children: [
                        new TableCell({ children: [new Paragraph({ text: "Critério DISCERN", children: [new TextRun({ bold: true })]})] }),
                        new TableCell({ children: [new Paragraph({ text: "Score", children: [new TextRun({ bold: true })]})] }),
                        new TableCell({ children: [new Paragraph({ text: "Justificativa", children: [new TextRun({ bold: true })]})] }),
                    ],
                });

                children.push(new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: [headerRow, ...tableRows]
                }));
                
                children.push(new Paragraph({ text: " ", pageBreakBefore: true }));

                return children;
            }),
        }],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `${filename}.docx`);
}

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { type AnalysisItem } from "./types";

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

  const headers = [
    'index', 'url', 'status', 'motivo', 'titulo',
    'score_geral', 'confiabilidade_avg', 'qualidade_tratamento_avg',
    'resumo_executivo', 'observacoes', 'recomendacoes'
  ];
  
  const rows = data.map(item => [
    escapeCsvField(item.index),
    escapeCsvField(item.url),
    escapeCsvField(item.status),
    escapeCsvField(item.reason),
    escapeCsvField(item.meta?.title),
    escapeCsvField(item.discernResult?.domainAverages.score_geral),
    escapeCsvField(item.discernResult?.domainAverages.confiabilidade),
    escapeCsvField(item.discernResult?.domainAverages.qualidade_tratamento),
    escapeCsvField(item.discernResult?.resumo),
    escapeCsvField(item.discernResult?.observacoes),
    escapeCsvField(item.discernResult?.recommmendacoes),
  ].join(','));

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

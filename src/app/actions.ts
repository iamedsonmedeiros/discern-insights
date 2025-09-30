"use server";

import { performDiscernAnalysis } from "@/ai/flows/perform-discern-analysis";
import { summarizeLongContent } from "@/ai/flows/summarize-long-content";
import { createScientificArticle } from "@/ai/flows/create-scientific-article";
import type { AnalysisItem, AnalysisStatus } from "@/lib/types";

function htmlToText(html: string): string {
  // Remove script, style, and head elements
  let cleanHtml = html.replace(/<script[^>]*>.*?<\/script>/gis, "");
  cleanHtml = cleanHtml.replace(/<style[^>]*>.*?<\/style>/gis, "");
  cleanHtml = cleanHtml.replace(/<head[^>]*>.*?<\/head>/gis, "");
  
  // Convert block-level elements to newlines
  cleanHtml = cleanHtml.replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, "\n");
  
  // Remove all remaining HTML tags
  cleanHtml = cleanHtml.replace(/<[^>]+>/g, " ");
  
  // Replace multiple newlines/spaces with a single one
  cleanHtml = cleanHtml.replace(/(\s*\n\s*)+/g, "\n");
  cleanHtml = cleanHtml.replace(/[ \t]+/g, " ");

  // Decode HTML entities
  cleanHtml = cleanHtml.replace(/&nbsp;/g, " ");
  cleanHtml = cleanHtml.replace(/&amp;/g, "&");
  cleanHtml = cleanHtml.replace(/&lt;/g, "<");
  cleanHtml = cleanHtml.replace(/&gt;/g, ">");
  cleanHtml = cleanHtml.replace(/&quot;/g, '"');
  cleanHtml = cleanHtml.replace(/&#39;/g, "'");

  return cleanHtml.trim();
}

export async function processUrl(
  url: string
): Promise<Pick<AnalysisItem, "status" | "reason" | "meta" | "discernResult">> {
  let status: AnalysisStatus = "processing";
  let reason: string | undefined;
  let meta: AnalysisItem["meta"] = {};
  let discernResult: AnalysisItem["discernResult"] | undefined;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });

    meta.httpStatus = response.status;

    if (!response.ok) {
      return {
        status: "unavailable_offline",
        reason: `Erro HTTP: ${response.status} ${response.statusText}`,
        meta,
      };
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/pdf")) {
      return {
        status: "not_eligible_pdf",
        reason: "Conteúdo é um arquivo PDF.",
        meta,
      };
    }

    const html = await response.text();
    meta.size = html.length;
    
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    meta.title = titleMatch ? titleMatch[1] : "Sem título";

    if (html.includes('<video') || /youtube\.com\/embed|vimeo\.com\/player/.test(html)) {
      return {
        status: "not_eligible_video",
        reason: "Conteúdo parece ser um vídeo.",
        meta,
      };
    }

    let textContent = htmlToText(html);
    
    if (!textContent) {
      return {
        status: "scraping_error",
        reason: "Não foi possível extrair conteúdo de texto da página.",
        meta,
      };
    }

    if (textContent.length > 30000) {
      try {
        const summaryResult = await summarizeLongContent({ text: textContent });
        textContent = summaryResult.summary;
      } catch (e) {
        console.error("Summarization failed:", e);
        // Continue with truncated content if summarization fails
        textContent = textContent.substring(0, 30000);
      }
    }

    try {
      discernResult = await performDiscernAnalysis({ text: textContent });
      status = "completed";
    } catch (e) {
      console.error("DISCERN analysis failed:", e);
      status = "analysis_error";
      reason =
        e instanceof Error ? e.message : "Erro desconhecido durante a análise.";
    }
  } catch (error) {
    status = "scraping_error";
    if (error instanceof Error) {
      if (error.name === "TimeoutError") {
        reason = "A requisição excedeu o tempo limite de 20 segundos.";
      } else {
        reason = `Falha na extração: ${error.message}`;
      }
    } else {
      reason = "Ocorreu um erro desconhecido na extração.";
    }
  }

  return { status, reason, meta, discernResult };
}


export async function generateArticleAction({ items }: { items: AnalysisItem[] }) {
  try {
    const result = await createScientificArticle({ items });
    return result;
  } catch (error) {
    console.error("Article generation failed:", error);
    throw new Error("A IA não conseguiu gerar o artigo.");
  }
}

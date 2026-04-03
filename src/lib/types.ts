import type { PerformDiscernAnalysisOutput as PDORaw } from "@/ai/flows/perform-discern-analysis";

// We re-export the type here to avoid a direct dependency on the AI flow file in components.
export type PerformDiscernAnalysisOutput = PDORaw;

export type AnalysisStatus =
  | "pending"
  | "processing"
  | "completed"
  | "not_eligible_pdf"
  | "not_eligible_video"
  | "unavailable_offline"
  | "scraping_error"
  | "analysis_error";

export type AnalysisItem = {
  id: string;
  index: number;
  url: string;
  status: AnalysisStatus;
  reason?: string;
  updatedAt: string;
  meta?: {
    title?: string;
    size?: number;
    httpStatus?: number;
  };
  modelId?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalCost?: number;
  discernResult?: PerformDiscernAnalysisOutput;
  jobId?: string;
};

export type AnalysisJob = {
  id: string;
  user_id: string;
  user_email: string;
  total_urls: number;
  completed_urls: number;
  failed_urls: number;
  status: "pending" | "processing" | "done" | "failed";
  language: string;
  keyword?: string;
  created_at: string;
  updated_at: string;
};

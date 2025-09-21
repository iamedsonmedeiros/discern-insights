import type { PerformDiscernAnalysisOutput } from "@/ai/flows/perform-discern-analysis";

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
  discernResult?: PerformDiscernAnalysisOutput;
};

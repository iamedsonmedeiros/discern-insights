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
  discernResult?: PerformDiscernAnalysisOutput;
};

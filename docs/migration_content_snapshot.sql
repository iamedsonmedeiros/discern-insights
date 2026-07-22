-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)
--
-- Phase 0 of the multi-LLM consensus plan (docs/MULTI_LLM_CONSENSUS_PLAN.md):
-- persist the exact extracted text each analysis ran on, so the same snapshot
-- can later be re-used by multiple models and audited for reproducibility.

-- The cleaned text that was actually sent to the model (pre-summarization).
ALTER TABLE analysis_items ADD COLUMN IF NOT EXISTS content_snapshot TEXT;

-- SHA-256 of content_snapshot. Doubles as the per-model analysis cache key.
ALTER TABLE analysis_items ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- How the content was scraped: "jina" or "fetch".
ALTER TABLE analysis_items ADD COLUMN IF NOT EXISTS extraction_method TEXT;

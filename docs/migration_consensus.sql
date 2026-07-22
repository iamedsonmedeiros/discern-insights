-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)
--
-- Phase 2 of the multi-LLM consensus plan (docs/MULTI_LLM_CONSENSUS_PLAN.md):
-- two-stage fan-out (extract -> one worker per model) plus the consensus that
-- the last worker computes once every model has reported.

-- The complete model output (resumo, observações, recomendações, markdown), not
-- just the scores. The worker that finalizes an item picks one model's narrative
-- to show, and must be able to fall back to a non-primary model if the primary
-- one failed.
ALTER TABLE analysis_model_results ADD COLUMN IF NOT EXISTS result JSONB;

-- How many models were dispatched for this item. The item is finalized when
-- analysis_model_results holds this many rows for it.
ALTER TABLE analysis_items ADD COLUMN IF NOT EXISTS models_total INTEGER;

-- The computed consensus: per-item mean/min/max/range/sd + each model's score.
ALTER TABLE analysis_items ADD COLUMN IF NOT EXISTS consensus JSONB;

-- True when at least one item has a spread greater than 1 point between models.
ALTER TABLE analysis_items ADD COLUMN IF NOT EXISTS divergence_flag BOOLEAN DEFAULT FALSE;

-- Which DISCERN items diverged, e.g. {item04,item12}.
ALTER TABLE analysis_items ADD COLUMN IF NOT EXISTS divergent_items TEXT[];

-- True when one or more models in the panel failed, so the consensus rests on
-- fewer opinions than intended.
ALTER TABLE analysis_items ADD COLUMN IF NOT EXISTS panel_incomplete BOOLEAN DEFAULT FALSE;

-- The panel this job ran with, for reproducibility.
ALTER TABLE analysis_jobs ADD COLUMN IF NOT EXISTS models TEXT[];

-- Finalizing an item is a compare-and-swap: whichever model worker finishes last
-- flips the item out of 'processing' and is therefore the only one that computes
-- consensus and bumps the job counter. Postgres guarantees a single winner, which
-- is what keeps a QStash redelivery from double-counting the job progress.
CREATE INDEX IF NOT EXISTS analysis_items_job_status_idx
  ON analysis_items (job_id, status);

-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)
--
-- Phase 1 of the multi-LLM consensus plan (docs/MULTI_LLM_CONSENSUS_PLAN.md):
-- one row per (analysis item x model). The panel evaluates the same content
-- snapshot blind; consensus/divergence is computed from these rows in Phase 2.

CREATE TABLE IF NOT EXISTS analysis_model_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES analysis_items(id) ON DELETE CASCADE,

  provider TEXT NOT NULL,            -- "google" | "openrouter"
  model_id TEXT NOT NULL,            -- exact model id, for reproducibility
  status TEXT NOT NULL,              -- "done" | "failed"

  scores JSONB,                      -- the 16 DISCERN items
  justifications JSONB,
  domain_averages JSONB,

  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost DECIMAL(10, 6) DEFAULT 0,
  latency_ms INTEGER,
  error TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Idempotency: a re-delivered QStash message must not duplicate a model's
  -- verdict. Workers upsert on this key.
  UNIQUE (item_id, model_id)
);

CREATE INDEX IF NOT EXISTS analysis_model_results_item_id_idx
  ON analysis_model_results (item_id);

-- RLS: a user reads model results only for items they own. Writes go through
-- the service role (worker / server actions), which bypasses RLS.
ALTER TABLE analysis_model_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own model results" ON analysis_model_results;
CREATE POLICY "Users can read their own model results"
  ON analysis_model_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM analysis_items
      WHERE analysis_items.id = analysis_model_results.item_id
        AND analysis_items.user_id = auth.uid()
    )
  );

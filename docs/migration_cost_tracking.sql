-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)

-- Add model and usage tracking columns to analysis_itemsTable
ALTER TABLE analysis_items ADD COLUMN IF NOT EXISTS model_id TEXT;
ALTER TABLE analysis_items ADD COLUMN IF NOT EXISTS input_tokens INTEGER DEFAULT 0;
ALTER TABLE analysis_items ADD COLUMN IF NOT EXISTS output_tokens INTEGER DEFAULT 0;
ALTER TABLE analysis_items ADD COLUMN IF NOT EXISTS total_cost DECIMAL(10, 6) DEFAULT 0;

-- Optional: You can also track this in the analysis_jobs table if you want job-level cost tracking
ALTER TABLE analysis_jobs ADD COLUMN IF NOT EXISTS total_cost DECIMAL(10, 6) DEFAULT 0;
ALTER TABLE analysis_jobs ADD COLUMN IF NOT EXISTS total_input_tokens INTEGER DEFAULT 0;
ALTER TABLE analysis_jobs ADD COLUMN IF NOT EXISTS total_output_tokens INTEGER DEFAULT 0;

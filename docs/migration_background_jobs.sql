-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)

-- 1. Add job_id column to existing analysis_items table
ALTER TABLE analysis_items ADD COLUMN IF NOT EXISTS job_id UUID;

-- 2. Create the analysis_jobs table
CREATE TABLE IF NOT EXISTS analysis_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  total_urls INT NOT NULL DEFAULT 0,
  completed_urls INT NOT NULL DEFAULT 0,
  failed_urls INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | processing | done | failed
  language TEXT NOT NULL DEFAULT 'pt-BR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Enable Row Level Security
ALTER TABLE analysis_jobs ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policy: users can only see and manage their own jobs
CREATE POLICY "Users manage own jobs"
  ON analysis_jobs
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 5. Enable Realtime for live progress updates
ALTER PUBLICATION supabase_realtime ADD TABLE analysis_jobs;

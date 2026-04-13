-- Migration: Atomic counter functions for parallel job processing
-- These RPC functions use PostgreSQL row-level locking to safely increment
-- job progress counters from multiple concurrent workers.

CREATE OR REPLACE FUNCTION increment_completed(p_job_id UUID)
RETURNS TABLE(completed_urls INT, failed_urls INT, total_urls INT)
LANGUAGE sql AS $$
  UPDATE analysis_jobs
  SET completed_urls = analysis_jobs.completed_urls + 1,
      updated_at = NOW()
  WHERE id = p_job_id
  RETURNING analysis_jobs.completed_urls, analysis_jobs.failed_urls, analysis_jobs.total_urls;
$$;

CREATE OR REPLACE FUNCTION increment_failed(p_job_id UUID)
RETURNS TABLE(completed_urls INT, failed_urls INT, total_urls INT)
LANGUAGE sql AS $$
  UPDATE analysis_jobs
  SET failed_urls = analysis_jobs.failed_urls + 1,
      updated_at = NOW()
  WHERE id = p_job_id
  RETURNING analysis_jobs.completed_urls, analysis_jobs.failed_urls, analysis_jobs.total_urls;
$$;

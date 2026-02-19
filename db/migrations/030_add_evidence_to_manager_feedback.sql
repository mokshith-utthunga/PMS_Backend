-- Migration: Add evidence column to quarterly_kpi_manager_feedback table
-- This column stores SharePoint URLs for manager-uploaded evidence documents
-- Similar to the evidence column in goal_self_ratings for employee uploads

ALTER TABLE IF EXISTS public.quarterly_kpi_manager_feedback
    ADD COLUMN IF NOT EXISTS evidence text COLLATE pg_catalog."default";

COMMENT ON COLUMN public.quarterly_kpi_manager_feedback.evidence IS 
    'JSON array of SharePoint URLs for manager-uploaded evidence documents. Stored as JSON string for backward compatibility.';

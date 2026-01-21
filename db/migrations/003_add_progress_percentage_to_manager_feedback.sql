-- Migration: Add progress_percentage to quarterly_kpi_manager_feedback
-- This allows persisting the manager's progress bar percentage

-- Add progress_percentage column to quarterly_kpi_manager_feedback
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'quarterly_kpi_manager_feedback' AND column_name = 'progress_percentage'
  ) THEN
    ALTER TABLE quarterly_kpi_manager_feedback 
    ADD COLUMN progress_percentage INTEGER;
  END IF;
END $$;

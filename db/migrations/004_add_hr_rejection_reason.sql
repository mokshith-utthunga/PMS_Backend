-- Migration: Add HR rejection reason to quarterly_manager_reviews
-- This allows storing why HR rejected a manager review

-- Add hr_rejection_reason column to quarterly_manager_reviews
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'quarterly_manager_reviews' AND column_name = 'hr_rejection_reason'
  ) THEN
    ALTER TABLE quarterly_manager_reviews 
    ADD COLUMN hr_rejection_reason TEXT;
  END IF;
END $$;

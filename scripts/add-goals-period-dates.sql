-- Add period_start_date and period_end_date columns to goals table if they don't exist
-- This is a fix for migration 021 which didn't include these columns for goals

ALTER TABLE goals
ADD COLUMN IF NOT EXISTS period_start_date DATE,
ADD COLUMN IF NOT EXISTS period_end_date DATE;

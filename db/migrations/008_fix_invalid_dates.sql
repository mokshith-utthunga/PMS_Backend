-- Migration: Fix invalid date ordering in quarterly_cycles
-- Run this BEFORE migration 008_optimize_cycles_tables.sql if you get constraint violations
-- Date: 2024
-- Updated: 2026-01-23 - Removed references to goals_quarterly_cycles columns that no longer exist

-- =====================================================
-- FIX quarterly_cycles INVALID DATES
-- =====================================================

-- Fix rows where quarter_start_date > quarter_end_date
UPDATE public.quarterly_cycles
SET quarter_end_date = quarter_start_date + INTERVAL '3 months' - INTERVAL '1 day'
WHERE quarter_start_date > quarter_end_date;

-- Note: Ordering constraints between self_review and manager_review dates have been removed.
-- The only constraint now is that dates must be within the quarter range.
-- The following fixes are kept for backward compatibility but are optional.

-- Fix rows where self_review_start_date > self_review_end_date (optional - no constraint enforced)
UPDATE public.quarterly_cycles
SET self_review_end_date = self_review_start_date + INTERVAL '7 days'
WHERE self_review_start_date IS NOT NULL 
  AND self_review_end_date IS NOT NULL 
  AND self_review_start_date > self_review_end_date;

-- Fix rows where manager_review_start_date > manager_review_end_date (optional - no constraint enforced)
UPDATE public.quarterly_cycles
SET manager_review_end_date = manager_review_start_date + INTERVAL '14 days'
WHERE manager_review_start_date > manager_review_end_date;

-- =====================================================
-- goals_quarterly_cycles - No fixes needed
-- =====================================================
-- The quarterly_start_date and quarterly_end_date columns have been removed
-- from goals_quarterly_cycles (they are now fetched via FK from quarterly_cycles).
-- No ordering constraints exist - only date range validation in API.

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================

-- Check for remaining invalid dates in quarterly_cycles (only quarter date range)
DO $$
DECLARE
    invalid_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO invalid_count
    FROM public.quarterly_cycles
    WHERE quarter_start_date > quarter_end_date;
    
    IF invalid_count > 0 THEN
        RAISE WARNING 'Still found % rows where quarter_start_date > quarter_end_date in quarterly_cycles. Manual intervention required.', invalid_count;
    ELSE
        RAISE NOTICE 'All quarter date ranges in quarterly_cycles are valid.';
    END IF;
END $$;

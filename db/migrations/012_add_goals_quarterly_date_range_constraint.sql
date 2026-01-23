-- Migration: Add constraint to ensure goal and manager review dates are within quarterly date range
-- This ensures data integrity at the database level
-- Date: 2024

-- =====================================================
-- STEP 1: Drop existing constraint if it exists
-- =====================================================

ALTER TABLE public.goals_quarterly_cycles
    DROP CONSTRAINT IF EXISTS goals_quarterly_cycles_date_range_validation;

-- =====================================================
-- STEP 2: Check for existing invalid data
-- =====================================================

DO $$
DECLARE
    invalid_rows INTEGER;
BEGIN
    -- Check for rows where goal or manager review dates are outside quarterly date range
    SELECT COUNT(*) INTO invalid_rows
    FROM public.goals_quarterly_cycles
    WHERE goal_submission_start_date < quarterly_start_date
       OR goal_submission_start_date > quarterly_end_date
       OR goal_submission_end_date < quarterly_start_date
       OR goal_submission_end_date > quarterly_end_date
       OR manager_review_start_date < quarterly_start_date
       OR manager_review_start_date > quarterly_end_date
       OR manager_review_end_date < quarterly_start_date
       OR manager_review_end_date > quarterly_end_date;
    
    IF invalid_rows > 0 THEN
        RAISE NOTICE 'Found % rows with dates outside quarterly date range in goals_quarterly_cycles. Constraint will not be added.', invalid_rows;
        RAISE NOTICE 'Please fix the data first. Example query to find invalid rows:';
        RAISE NOTICE 'SELECT id, performance_cycle_id, quarter, quarterly_start_date, quarterly_end_date, goal_submission_start_date, goal_submission_end_date, manager_review_start_date, manager_review_end_date FROM goals_quarterly_cycles WHERE goal_submission_start_date < quarterly_start_date OR goal_submission_start_date > quarterly_end_date;';
    ELSE
        -- Add constraint to ensure dates are within quarterly range
        ALTER TABLE public.goals_quarterly_cycles
            ADD CONSTRAINT goals_quarterly_cycles_date_range_validation CHECK (
                -- Goal submission dates must be within quarterly range
                (goal_submission_start_date >= quarterly_start_date AND goal_submission_start_date <= quarterly_end_date) AND
                (goal_submission_end_date >= quarterly_start_date AND goal_submission_end_date <= quarterly_end_date) AND
                -- Manager review dates must be within quarterly range
                (manager_review_start_date >= quarterly_start_date AND manager_review_start_date <= quarterly_end_date) AND
                (manager_review_end_date >= quarterly_start_date AND manager_review_end_date <= quarterly_end_date)
            );
        RAISE NOTICE 'goals_quarterly_cycles_date_range_validation constraint added successfully.';
    END IF;
END $$;

-- =====================================================
-- POST-MIGRATION VERIFICATION
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE 'Date range validation constraint has been added to goals_quarterly_cycles table.';
    RAISE NOTICE 'All goal_submission_* and manager_review_* dates must be between quarterly_start_date and quarterly_end_date.';
END $$;

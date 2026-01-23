-- Migration: Remove annual goal and evaluation columns from performance_cycles
-- ⚠️ WARNING: This removes columns used for ANNUAL (year-end) goals and evaluations
-- ⚠️ Ensure you have migrated all annual data or don't use annual cycles
-- ⚠️ This migration is irreversible - ensure you have backups!
-- Date: 2024

-- =====================================================
-- PRE-MIGRATION CHECKS
-- =====================================================

-- Step 1: Check if any cycles are using these columns for year-end evaluations (if columns exist)
DO $$
DECLARE
    cycles_with_annual_evals INTEGER;
    cycles_with_annual_goals INTEGER;
    has_eval_cols BOOLEAN;
    has_goal_cols BOOLEAN;
BEGIN
    -- Check if evaluation columns exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND table_name = 'performance_cycles' 
        AND column_name = 'self_evaluation_start'
    ) INTO has_eval_cols;
    
    -- Check if goal columns exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND table_name = 'performance_cycles' 
        AND column_name = 'goal_submission_start'
    ) INTO has_goal_cols;
    
    -- Check for cycles with annual evaluation dates (if columns exist)
    IF has_eval_cols THEN
        EXECUTE format('
            SELECT COUNT(*) 
            FROM performance_cycles
            WHERE self_evaluation_start IS NOT NULL 
               OR self_evaluation_end IS NOT NULL
               OR manager_evaluation_start IS NOT NULL
               OR manager_evaluation_end IS NOT NULL
        ') INTO cycles_with_annual_evals;
        
        IF cycles_with_annual_evals > 0 THEN
            RAISE WARNING 'Found % cycles with annual evaluation dates. These will be removed.', cycles_with_annual_evals;
            RAISE WARNING 'Year-end evaluations should use quarterly_cycles with appropriate quarter handling.';
        END IF;
    ELSE
        cycles_with_annual_evals := 0;
        RAISE NOTICE 'Annual evaluation columns do not exist. Skipping check.';
    END IF;
    
    -- Check for cycles with annual goal dates (if columns exist)
    IF has_goal_cols THEN
        EXECUTE format('
            SELECT COUNT(*) 
            FROM performance_cycles
            WHERE goal_submission_start IS NOT NULL
               OR goal_submission_end IS NOT NULL
               OR goal_approval_end IS NOT NULL
        ') INTO cycles_with_annual_goals;
        
        IF cycles_with_annual_goals > 0 THEN
            RAISE WARNING 'Found % cycles with annual goal dates. These will be removed.', cycles_with_annual_goals;
            RAISE WARNING 'Annual goals should use goals_quarterly_cycles table.';
        END IF;
    ELSE
        cycles_with_annual_goals := 0;
        RAISE NOTICE 'Annual goal columns do not exist. Skipping check.';
    END IF;
    
    IF cycles_with_annual_evals = 0 AND cycles_with_annual_goals = 0 THEN
        RAISE NOTICE 'No cycles found using annual columns. Safe to proceed.';
    END IF;
END $$;

-- Step 2: Check if there are any year-end evaluations in the database
DO $$
DECLARE
    year_end_evals_count INTEGER;
BEGIN
    -- Check self_evaluations table for year-end evaluations (quarter IS NULL)
    SELECT COUNT(*) INTO year_end_evals_count
    FROM self_evaluations
    WHERE quarter IS NULL;
    
    IF year_end_evals_count > 0 THEN
        RAISE WARNING 'Found % year-end self evaluations (quarter IS NULL). Ensure these are handled properly.', year_end_evals_count;
    END IF;
END $$;

-- =====================================================
-- STEP 1: Drop indexes on columns to be removed (if any)
-- =====================================================

DROP INDEX IF EXISTS idx_performance_cycles_goal_submission_end;
DROP INDEX IF EXISTS idx_performance_cycles_manager_eval_end;

-- =====================================================
-- STEP 2: Drop constraints that reference these columns
-- =====================================================

ALTER TABLE public.performance_cycles
    DROP CONSTRAINT IF EXISTS performance_cycles_date_validation;

-- =====================================================
-- STEP 3: Remove annual goal columns
-- =====================================================

ALTER TABLE public.performance_cycles
    DROP COLUMN IF EXISTS goal_submission_start,
    DROP COLUMN IF EXISTS goal_submission_end,
    DROP COLUMN IF EXISTS goal_approval_end;

-- =====================================================
-- STEP 4: Remove annual evaluation columns
-- =====================================================

ALTER TABLE public.performance_cycles
    DROP COLUMN IF EXISTS self_evaluation_start,
    DROP COLUMN IF EXISTS self_evaluation_end,
    DROP COLUMN IF EXISTS manager_evaluation_start,
    DROP COLUMN IF EXISTS manager_evaluation_end;

-- =====================================================
-- STEP 5: Update table comment
-- =====================================================

COMMENT ON TABLE public.performance_cycles IS 
    'Main performance cycle table. Contains cycle metadata and configuration.
     All quarterly evaluation cycles are stored in quarterly_cycles table.
     All quarterly goal cycles are stored in goals_quarterly_cycles table.
     Annual (year-end) evaluations and goals should use quarterly tables with appropriate handling.';

-- =====================================================
-- STEP 6: Update remaining column comments
-- =====================================================

COMMENT ON COLUMN public.performance_cycles.allow_late_goal_submission IS 
    'Legacy field: Global late submission flag. For quarter-specific control, use goals_quarterly_cycles.allow_late_goal_submission';

-- =====================================================
-- POST-MIGRATION VERIFICATION
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE 'Annual goal and evaluation columns have been successfully removed from performance_cycles table.';
    RAISE NOTICE 'All goal and evaluation data should now be stored in:';
    RAISE NOTICE '  - quarterly_cycles (for quarterly evaluations)';
    RAISE NOTICE '  - goals_quarterly_cycles (for quarterly goals)';
    RAISE NOTICE '';
    RAISE NOTICE 'For year-end evaluations, consider using quarterly_cycles with a special quarter designation or a separate year_end_evaluations table.';
END $$;

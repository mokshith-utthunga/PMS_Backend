-- Migration: Optimize performance_cycles, quarterly_cycles, and goals_quarterly_cycles tables
-- This adds indexes and optimizations for better query performance
-- Date: 2024
-- Updated: 2026-01-23 - Removed ordering constraints, only date range validation in API

-- =====================================================
-- 1. OPTIMIZE performance_cycles TABLE
-- =====================================================

-- Add index on status (most common filter)
CREATE INDEX IF NOT EXISTS idx_performance_cycles_status 
    ON public.performance_cycles(status)
    WHERE status IN ('active', 'draft');

-- Add index on year (common filter)
CREATE INDEX IF NOT EXISTS idx_performance_cycles_year 
    ON public.performance_cycles(year DESC);

-- Add composite index for active cycles by year (common query pattern)
CREATE INDEX IF NOT EXISTS idx_performance_cycles_active_year 
    ON public.performance_cycles(year DESC, status)
    WHERE status = 'active';

-- Add index on created_at (for sorting)
CREATE INDEX IF NOT EXISTS idx_performance_cycles_created_at 
    ON public.performance_cycles(created_at DESC);

-- Add index on applicable_departments (for GIN index on array column)
CREATE INDEX IF NOT EXISTS idx_performance_cycles_applicable_departments 
    ON public.performance_cycles USING GIN(applicable_departments)
    WHERE applicable_departments IS NOT NULL;

-- Add index on applicable_business_units (for GIN index on array column)
CREATE INDEX IF NOT EXISTS idx_performance_cycles_applicable_business_units 
    ON public.performance_cycles USING GIN(applicable_business_units)
    WHERE applicable_business_units IS NOT NULL;

-- Add comments for documentation
COMMENT ON TABLE public.performance_cycles IS 
    'Main performance cycle table. Contains annual cycle configuration. 
     For quarterly data, use quarterly_cycles and goals_quarterly_cycles tables.';

COMMENT ON COLUMN public.performance_cycles.status IS 
    'Cycle status: draft (not active), active (currently running), closed (completed), archived (historical)';

COMMENT ON COLUMN public.performance_cycles.applicable_departments IS 
    'Array of department names. NULL means applies to all departments.';

COMMENT ON COLUMN public.performance_cycles.applicable_business_units IS 
    'Array of business unit names. NULL means applies to all business units.';

-- =====================================================
-- 2. OPTIMIZE quarterly_cycles TABLE
-- =====================================================

-- Add index on status (common filter)
CREATE INDEX IF NOT EXISTS idx_quarterly_cycles_status_active 
    ON public.quarterly_cycles(status)
    WHERE status = 'active';

-- Add index on quarter_start_date (for date range queries)
CREATE INDEX IF NOT EXISTS idx_quarterly_cycles_quarter_start_date 
    ON public.quarterly_cycles(quarter_start_date);

-- Add index on quarter_end_date (for date range queries)
CREATE INDEX IF NOT EXISTS idx_quarterly_cycles_quarter_end_date 
    ON public.quarterly_cycles(quarter_end_date);

-- Add index on self_review_end_date (for deadline checks)
CREATE INDEX IF NOT EXISTS idx_quarterly_cycles_self_review_end_date 
    ON public.quarterly_cycles(self_review_end_date)
    WHERE self_review_end_date IS NOT NULL;

-- Add index on manager_review_end_date (for deadline checks)
CREATE INDEX IF NOT EXISTS idx_quarterly_cycles_manager_review_end_date 
    ON public.quarterly_cycles(manager_review_end_date);

-- Add composite index for active cycles by performance_cycle_id and quarter
CREATE INDEX IF NOT EXISTS idx_quarterly_cycles_active_cycle_quarter 
    ON public.quarterly_cycles(performance_cycle_id, quarter, status)
    WHERE status = 'active';

-- Drop old ordering constraints (no longer needed - only date range validation in API)
ALTER TABLE public.quarterly_cycles
    DROP CONSTRAINT IF EXISTS quarterly_cycles_date_validation;

ALTER TABLE public.quarterly_cycles
    DROP CONSTRAINT IF EXISTS quarterly_cycles_quarter_date_alignment;

-- Add simple constraint: quarter_start_date <= quarter_end_date
DO $$
DECLARE
    invalid_rows INTEGER;
BEGIN
    -- Check for rows that violate the constraint
    SELECT COUNT(*) INTO invalid_rows
    FROM public.quarterly_cycles
    WHERE quarter_start_date > quarter_end_date;
    
    IF invalid_rows > 0 THEN
        RAISE NOTICE 'Found % rows where quarter_start_date > quarter_end_date. Constraint will not be added.', invalid_rows;
        RAISE NOTICE 'Please fix the data first: UPDATE quarterly_cycles SET quarter_end_date = quarter_start_date + INTERVAL ''3 months'' - INTERVAL ''1 day'' WHERE quarter_start_date > quarter_end_date;';
    ELSE
        -- Only add constraint if all data is valid
        ALTER TABLE public.quarterly_cycles
            DROP CONSTRAINT IF EXISTS quarterly_cycles_quarter_range_check;
        ALTER TABLE public.quarterly_cycles
            ADD CONSTRAINT quarterly_cycles_quarter_range_check CHECK (
                quarter_start_date <= quarter_end_date
            );
        RAISE NOTICE 'quarterly_cycles_quarter_range_check constraint added successfully.';
    END IF;
END $$;

-- =====================================================
-- 3. OPTIMIZE goals_quarterly_cycles TABLE
-- =====================================================

-- Add index on status (common filter)
CREATE INDEX IF NOT EXISTS idx_goals_quarterly_cycles_status_active 
    ON public.goals_quarterly_cycles(status)
    WHERE status = 'active';

-- Add index on goal_submission_end_date (for deadline checks - most critical)
CREATE INDEX IF NOT EXISTS idx_goals_quarterly_cycles_goal_submission_end_date 
    ON public.goals_quarterly_cycles(goal_submission_end_date);

-- Add index on goal_submission_start_date (for date range queries)
CREATE INDEX IF NOT EXISTS idx_goals_quarterly_cycles_goal_submission_start_date 
    ON public.goals_quarterly_cycles(goal_submission_start_date);

-- Add index on manager_review_end_date (for deadline checks)
CREATE INDEX IF NOT EXISTS idx_goals_quarterly_cycles_manager_review_end_date 
    ON public.goals_quarterly_cycles(manager_review_end_date);

-- Add composite index for active cycles by performance_cycle_id and quarter
CREATE INDEX IF NOT EXISTS idx_goals_quarterly_cycles_active_cycle_quarter 
    ON public.goals_quarterly_cycles(performance_cycle_id, quarter, status)
    WHERE status = 'active';

-- Add partial index for allow_late_goal_submission = true (common query)
CREATE INDEX IF NOT EXISTS idx_goals_quarterly_cycles_allow_late 
    ON public.goals_quarterly_cycles(performance_cycle_id, quarter)
    WHERE allow_late_goal_submission = true;

-- Drop old ordering constraints (no longer needed - only date range validation in API)
ALTER TABLE public.goals_quarterly_cycles
    DROP CONSTRAINT IF EXISTS goals_quarterly_cycles_date_validation;

ALTER TABLE public.goals_quarterly_cycles
    DROP CONSTRAINT IF EXISTS goals_quarterly_cycles_date_range_validation;

ALTER TABLE public.goals_quarterly_cycles
    DROP CONSTRAINT IF EXISTS goals_quarterly_cycles_quarter_date_alignment;

-- Note: No constraints on goals_quarterly_cycles
-- quarterly_start_date and quarterly_end_date columns have been removed
-- Date validation is done in API against quarterly_cycles.quarter_start_date/quarter_end_date

-- =====================================================
-- 4. ADD FOREIGN KEY INDEXES (if not already present)
-- =====================================================

-- Index on performance_cycles.created_by (foreign key)
CREATE INDEX IF NOT EXISTS idx_performance_cycles_created_by 
    ON public.performance_cycles(created_by)
    WHERE created_by IS NOT NULL;

-- =====================================================
-- 5. ANALYZE TABLES FOR QUERY PLANNER
-- =====================================================

ANALYZE public.performance_cycles;
ANALYZE public.quarterly_cycles;
ANALYZE public.goals_quarterly_cycles;

-- =====================================================
-- DONE
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE 'Migration 008_optimize_cycles_tables.sql completed successfully.';
    RAISE NOTICE 'Date ordering constraints have been removed.';
    RAISE NOTICE 'Only constraint: quarter_start_date <= quarter_end_date in quarterly_cycles.';
    RAISE NOTICE 'All other date validation is done in the API.';
END $$;

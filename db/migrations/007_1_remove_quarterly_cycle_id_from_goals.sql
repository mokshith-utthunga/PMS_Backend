-- Migration: Remove quarterly_cycle_id foreign key from goals_quarterly_cycles
-- This makes goals_quarterly_cycles independent from quarterly_cycles
-- Goals and evaluations can have different timelines and exist independently
-- Date: 2024

-- =====================================================
-- STEP 1: Drop the foreign key constraint
-- =====================================================

ALTER TABLE public.goals_quarterly_cycles
    DROP CONSTRAINT IF EXISTS goals_qc_quarterly_cycle_fkey;

-- =====================================================
-- STEP 2: Drop the index on quarterly_cycle_id (if exists)
-- =====================================================

DROP INDEX IF EXISTS idx_goals_quarterly_cycles_quarterly_cycle_id;

-- =====================================================
-- STEP 3: Drop the quarterly_cycle_id column
-- =====================================================

ALTER TABLE public.goals_quarterly_cycles
    DROP COLUMN IF EXISTS quarterly_cycle_id;

-- =====================================================
-- STEP 4: Update table comment
-- =====================================================

COMMENT ON TABLE public.goals_quarterly_cycles IS 
    'Stores quarterly goal submission and approval timelines, independent from evaluation cycles.
     Goals and evaluations can have different timelines and can exist independently.
     Both tables link to performance_cycles via performance_cycle_id and quarter.';

-- =====================================================
-- POST-MIGRATION VERIFICATION
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE 'quarterly_cycle_id column has been successfully removed from goals_quarterly_cycles table.';
    RAISE NOTICE 'goals_quarterly_cycles is now independent from quarterly_cycles.';
    RAISE NOTICE 'Goals and evaluations can have different timelines and exist independently.';
END $$;

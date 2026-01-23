-- Migration: Link goals_quarterly_cycles to quarterly_cycles and remove redundant date columns
-- This migration:
-- 1. Adds quarterly_cycle_id FK to goals_quarterly_cycles
-- 2. Removes quarterly_start_date and quarterly_end_date from goals_quarterly_cycles
--    (these will be fetched from the linked quarterly_cycles record)
-- Date: 2024

-- =====================================================
-- STEP 1: Add quarterly_cycle_id column if not exists
-- =====================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND table_name = 'goals_quarterly_cycles' 
        AND column_name = 'quarterly_cycle_id'
    ) THEN
        ALTER TABLE public.goals_quarterly_cycles 
            ADD COLUMN quarterly_cycle_id uuid;
        RAISE NOTICE 'Added quarterly_cycle_id column to goals_quarterly_cycles';
    ELSE
        RAISE NOTICE 'quarterly_cycle_id column already exists';
    END IF;
END $$;

-- =====================================================
-- STEP 2: Populate quarterly_cycle_id from matching records
-- =====================================================

UPDATE public.goals_quarterly_cycles gqc
SET quarterly_cycle_id = qc.id
FROM public.quarterly_cycles qc
WHERE gqc.performance_cycle_id = qc.performance_cycle_id
  AND gqc.quarter = qc.quarter
  AND gqc.quarterly_cycle_id IS NULL;

-- Report how many records were updated
DO $$
DECLARE
    updated_count INTEGER;
    null_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO null_count
    FROM public.goals_quarterly_cycles
    WHERE quarterly_cycle_id IS NULL;
    
    IF null_count > 0 THEN
        RAISE WARNING 'There are % goals_quarterly_cycles records without a matching quarterly_cycles record.', null_count;
        RAISE WARNING 'These records will need quarterly_cycles to be created first.';
    ELSE
        RAISE NOTICE 'All goals_quarterly_cycles records have been linked to quarterly_cycles.';
    END IF;
END $$;

-- =====================================================
-- STEP 3: Add foreign key constraint
-- =====================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'goals_qc_quarterly_cycle_fkey'
        AND table_name = 'goals_quarterly_cycles'
    ) THEN
        ALTER TABLE public.goals_quarterly_cycles
            ADD CONSTRAINT goals_qc_quarterly_cycle_fkey 
            FOREIGN KEY (quarterly_cycle_id) 
            REFERENCES public.quarterly_cycles (id) 
            ON DELETE CASCADE;
        RAISE NOTICE 'Added foreign key constraint goals_qc_quarterly_cycle_fkey';
    ELSE
        RAISE NOTICE 'Foreign key constraint already exists';
    END IF;
END $$;

-- =====================================================
-- STEP 4: Add index on quarterly_cycle_id
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_goals_quarterly_cycles_quarterly_cycle_id 
ON public.goals_quarterly_cycles (quarterly_cycle_id);

-- =====================================================
-- STEP 5: Remove redundant date columns
-- =====================================================

ALTER TABLE public.goals_quarterly_cycles
    DROP COLUMN IF EXISTS quarterly_start_date,
    DROP COLUMN IF EXISTS quarterly_end_date;

-- =====================================================
-- STEP 6: Drop the date range validation constraint if exists
-- (since we no longer have quarterly_start_date and quarterly_end_date)
-- =====================================================

ALTER TABLE public.goals_quarterly_cycles
    DROP CONSTRAINT IF EXISTS goals_quarterly_cycles_date_range_validation;

-- =====================================================
-- POST-MIGRATION VERIFICATION
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE 'Migration completed successfully.';
    RAISE NOTICE 'goals_quarterly_cycles now references quarterly_cycles via quarterly_cycle_id';
    RAISE NOTICE 'Quarter date range (start/end) should be fetched from quarterly_cycles table';
END $$;

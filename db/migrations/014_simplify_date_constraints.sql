-- Migration: Simplify date validation constraints
-- Only validates that dates are within quarter range, no ordering constraints between date fields
-- Date: 2026-01-23

-- =====================================================
-- STEP 1: Drop existing ordering constraints from quarterly_cycles
-- =====================================================

DO $$
BEGIN
    -- Drop the date validation constraint if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'quarterly_cycles_date_validation'
        AND table_name = 'quarterly_cycles'
    ) THEN
        ALTER TABLE public.quarterly_cycles DROP CONSTRAINT quarterly_cycles_date_validation;
        RAISE NOTICE 'Dropped quarterly_cycles_date_validation constraint';
    ELSE
        RAISE NOTICE 'quarterly_cycles_date_validation constraint does not exist, skipping';
    END IF;
END $$;

-- =====================================================
-- STEP 2: Drop existing ordering constraints from goals_quarterly_cycles
-- =====================================================

DO $$
BEGIN
    -- Drop the date validation constraint if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'goals_quarterly_cycles_date_validation'
        AND table_name = 'goals_quarterly_cycles'
    ) THEN
        ALTER TABLE public.goals_quarterly_cycles DROP CONSTRAINT goals_quarterly_cycles_date_validation;
        RAISE NOTICE 'Dropped goals_quarterly_cycles_date_validation constraint';
    ELSE
        RAISE NOTICE 'goals_quarterly_cycles_date_validation constraint does not exist, skipping';
    END IF;
    
    -- Also drop the date range validation constraint if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'goals_quarterly_cycles_date_range_validation'
        AND table_name = 'goals_quarterly_cycles'
    ) THEN
        ALTER TABLE public.goals_quarterly_cycles DROP CONSTRAINT goals_quarterly_cycles_date_range_validation;
        RAISE NOTICE 'Dropped goals_quarterly_cycles_date_range_validation constraint';
    ELSE
        RAISE NOTICE 'goals_quarterly_cycles_date_range_validation constraint does not exist, skipping';
    END IF;
END $$;

-- =====================================================
-- STEP 3: Add simplified constraints (only quarter_start <= quarter_end)
-- =====================================================

-- For quarterly_cycles: only validate quarter_start_date <= quarter_end_date
DO $$
BEGIN
    -- Check if constraint already exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'quarterly_cycles_quarter_range_check'
        AND table_name = 'quarterly_cycles'
    ) THEN
        ALTER TABLE public.quarterly_cycles
            ADD CONSTRAINT quarterly_cycles_quarter_range_check CHECK (
                quarter_start_date <= quarter_end_date
            );
        RAISE NOTICE 'Added quarterly_cycles_quarter_range_check constraint';
    ELSE
        RAISE NOTICE 'quarterly_cycles_quarter_range_check constraint already exists, skipping';
    END IF;
END $$;

-- =====================================================
-- POST-MIGRATION VERIFICATION
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE 'Date validation constraints have been simplified.';
    RAISE NOTICE 'Only constraint: quarter_start_date <= quarter_end_date';
    RAISE NOTICE 'All other date fields just need to be within the quarter range (validated in API).';
END $$;

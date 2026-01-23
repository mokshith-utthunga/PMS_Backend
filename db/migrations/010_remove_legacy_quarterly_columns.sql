-- Migration: Remove legacy quarterly columns from performance_cycles
-- ⚠️ WARNING: Only run this after ALL code has been migrated to use quarterly_cycles and goals_quarterly_cycles
-- ⚠️ This migration is irreversible - ensure you have backups!
-- Date: 2024

-- =====================================================
-- PRE-MIGRATION CHECKS
-- =====================================================

-- Step 1: Verify all cycles have been migrated to new tables (only if columns exist)
DO $$
DECLARE
    cycles_without_migration INTEGER;
    has_q1_cols BOOLEAN;
BEGIN
    -- Check if quarterly columns exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND table_name = 'performance_cycles' 
        AND column_name = 'q1_self_review_start'
    ) INTO has_q1_cols;
    
    -- Only run pre-migration check if columns exist
    IF has_q1_cols THEN
        -- Check for cycles that have legacy data but no new table data
        EXECUTE format('
            SELECT COUNT(*) 
            FROM performance_cycles pc
            WHERE (
                (q1_self_review_start IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM quarterly_cycles qc 
                    WHERE qc.performance_cycle_id = pc.id AND qc.quarter = 1
                ))
                OR
                (q2_self_review_start IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM quarterly_cycles qc 
                    WHERE qc.performance_cycle_id = pc.id AND qc.quarter = 2
                ))
                OR
                (q3_self_review_start IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM quarterly_cycles qc 
                    WHERE qc.performance_cycle_id = pc.id AND qc.quarter = 3
                ))
                OR
                (q4_self_review_start IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM quarterly_cycles qc 
                    WHERE qc.performance_cycle_id = pc.id AND qc.quarter = 4
                ))
            )
        ') INTO cycles_without_migration;
        
        IF cycles_without_migration > 0 THEN
            RAISE EXCEPTION 'Cannot remove legacy columns: % cycles have data in legacy columns but not in new tables. Run migration 007 first.', cycles_without_migration;
        END IF;
        
        RAISE NOTICE 'Pre-migration check passed. All cycles have been migrated to new tables.';
    ELSE
        RAISE NOTICE 'Quarterly columns do not exist. Skipping pre-migration check.';
    END IF;
END $$;

-- =====================================================
-- STEP 1: Drop the sync function (no longer needed)
-- =====================================================

DROP FUNCTION IF EXISTS public.sync_legacy_quarterly_columns();

-- =====================================================
-- STEP 2: Drop the migration status view (no longer needed)
-- =====================================================

DROP VIEW IF EXISTS public.performance_cycles_legacy_columns_status;

-- =====================================================
-- STEP 3: Drop indexes on legacy columns (if any)
-- =====================================================

-- Note: There shouldn't be any indexes specifically on these columns,
-- but we check and drop them if they exist

-- =====================================================
-- STEP 4: Remove legacy quarterly columns
-- =====================================================

ALTER TABLE public.performance_cycles
    DROP COLUMN IF EXISTS q1_self_review_start,
    DROP COLUMN IF EXISTS q1_self_review_end,
    DROP COLUMN IF EXISTS q1_manager_review_start,
    DROP COLUMN IF EXISTS q1_manager_review_end,
    DROP COLUMN IF EXISTS q2_self_review_start,
    DROP COLUMN IF EXISTS q2_self_review_end,
    DROP COLUMN IF EXISTS q2_manager_review_start,
    DROP COLUMN IF EXISTS q2_manager_review_end,
    DROP COLUMN IF EXISTS q3_self_review_start,
    DROP COLUMN IF EXISTS q3_self_review_end,
    DROP COLUMN IF EXISTS q3_manager_review_start,
    DROP COLUMN IF EXISTS q3_manager_review_end,
    DROP COLUMN IF EXISTS q4_self_review_start,
    DROP COLUMN IF EXISTS q4_self_review_end,
    DROP COLUMN IF EXISTS q4_manager_review_start,
    DROP COLUMN IF EXISTS q4_manager_review_end;

-- =====================================================
-- STEP 5: Update table comment
-- =====================================================

COMMENT ON TABLE public.performance_cycles IS 
    'Main performance cycle table. Contains annual cycle configuration.
     For quarterly evaluation cycles, use quarterly_cycles table.
     For quarterly goal cycles, use goals_quarterly_cycles table.';

-- =====================================================
-- STEP 6: Remove constraint that references legacy columns
-- =====================================================

ALTER TABLE public.performance_cycles
    DROP CONSTRAINT IF EXISTS performance_cycles_quarterly_dates_validation;

-- =====================================================
-- POST-MIGRATION VERIFICATION
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE 'Legacy quarterly columns have been successfully removed from performance_cycles table.';
    RAISE NOTICE 'All quarterly data is now stored in quarterly_cycles and goals_quarterly_cycles tables.';
END $$;

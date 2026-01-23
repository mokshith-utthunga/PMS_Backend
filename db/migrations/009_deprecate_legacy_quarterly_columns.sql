-- Migration: Deprecate legacy quarterly columns in performance_cycles
-- These columns are replaced by quarterly_cycles and goals_quarterly_cycles tables
-- This migration marks them as deprecated and prepares for eventual removal
-- Date: 2024

-- =====================================================
-- STEP 1: Add comments marking columns as deprecated (if columns exist)
-- =====================================================

DO $$
DECLARE
    has_q1_cols BOOLEAN;
BEGIN
    -- Check if quarterly columns exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND table_name = 'performance_cycles' 
        AND column_name = 'q1_self_review_start'
    ) INTO has_q1_cols;
    
    -- Only add comments if columns exist
    IF has_q1_cols THEN
        COMMENT ON COLUMN public.performance_cycles.q1_self_review_start IS 
            'DEPRECATED: Use quarterly_cycles table instead. This column will be removed in a future version.';
        
        COMMENT ON COLUMN public.performance_cycles.q1_self_review_end IS 
            'DEPRECATED: Use quarterly_cycles table instead. This column will be removed in a future version.';
        
        COMMENT ON COLUMN public.performance_cycles.q1_manager_review_start IS 
            'DEPRECATED: Use quarterly_cycles table instead. This column will be removed in a future version.';
        
        COMMENT ON COLUMN public.performance_cycles.q1_manager_review_end IS 
            'DEPRECATED: Use quarterly_cycles table instead. This column will be removed in a future version.';
        
        COMMENT ON COLUMN public.performance_cycles.q2_self_review_start IS 
            'DEPRECATED: Use quarterly_cycles table instead. This column will be removed in a future version.';
        
        COMMENT ON COLUMN public.performance_cycles.q2_self_review_end IS 
            'DEPRECATED: Use quarterly_cycles table instead. This column will be removed in a future version.';
        
        COMMENT ON COLUMN public.performance_cycles.q2_manager_review_start IS 
            'DEPRECATED: Use quarterly_cycles table instead. This column will be removed in a future version.';
        
        COMMENT ON COLUMN public.performance_cycles.q2_manager_review_end IS 
            'DEPRECATED: Use quarterly_cycles table instead. This column will be removed in a future version.';
        
        COMMENT ON COLUMN public.performance_cycles.q3_self_review_start IS 
            'DEPRECATED: Use quarterly_cycles table instead. This column will be removed in a future version.';
        
        COMMENT ON COLUMN public.performance_cycles.q3_self_review_end IS 
            'DEPRECATED: Use quarterly_cycles table instead. This column will be removed in a future version.';
        
        COMMENT ON COLUMN public.performance_cycles.q3_manager_review_start IS 
            'DEPRECATED: Use quarterly_cycles table instead. This column will be removed in a future version.';
        
        COMMENT ON COLUMN public.performance_cycles.q3_manager_review_end IS 
            'DEPRECATED: Use quarterly_cycles table instead. This column will be removed in a future version.';
        
        COMMENT ON COLUMN public.performance_cycles.q4_self_review_start IS 
            'DEPRECATED: Use quarterly_cycles table instead. This column will be removed in a future version.';
        
        COMMENT ON COLUMN public.performance_cycles.q4_self_review_end IS 
            'DEPRECATED: Use quarterly_cycles table instead. This column will be removed in a future version.';
        
        COMMENT ON COLUMN public.performance_cycles.q4_manager_review_start IS 
            'DEPRECATED: Use quarterly_cycles table instead. This column will be removed in a future version.';
        
        COMMENT ON COLUMN public.performance_cycles.q4_manager_review_end IS 
            'DEPRECATED: Use quarterly_cycles table instead. This column will be removed in a future version.';
        
        RAISE NOTICE 'Deprecated comments added to quarterly columns.';
    ELSE
        RAISE NOTICE 'Quarterly columns (q1_*, q2_*, q3_*, q4_*) do not exist in performance_cycles. Skipping deprecation comments.';
    END IF;
END $$;

-- =====================================================
-- STEP 2: Mark goal submission columns as annual-only (if columns exist)
-- =====================================================

DO $$
DECLARE
    has_goal_cols BOOLEAN;
BEGIN
    -- Check if goal columns exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND table_name = 'performance_cycles' 
        AND column_name = 'goal_submission_start'
    ) INTO has_goal_cols;
    
    -- Only add comments if columns exist
    IF has_goal_cols THEN
        COMMENT ON COLUMN public.performance_cycles.goal_submission_start IS 
            'Annual goal submission start date. For quarterly goals, use goals_quarterly_cycles.goal_submission_start_date';
        
        COMMENT ON COLUMN public.performance_cycles.goal_submission_end IS 
            'Annual goal submission end date. For quarterly goals, use goals_quarterly_cycles.goal_submission_end_date';
        
        COMMENT ON COLUMN public.performance_cycles.goal_approval_end IS 
            'Annual goal approval end date. For quarterly goals, use goals_quarterly_cycles.manager_review_end_date';
        
        RAISE NOTICE 'Comments added to goal submission columns.';
    ELSE
        RAISE NOTICE 'Goal submission columns do not exist in performance_cycles. Skipping comments.';
    END IF;
END $$;

-- =====================================================
-- STEP 3: Create a view to help identify code still using deprecated columns (if columns exist)
-- =====================================================

DO $$
DECLARE
    has_q1_cols BOOLEAN;
BEGIN
    -- Check if quarterly columns exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND table_name = 'performance_cycles' 
        AND column_name = 'q1_self_review_start'
    ) INTO has_q1_cols;
    
    -- Only create view if columns exist
    IF has_q1_cols THEN
        -- This view helps identify which cycles still have data in deprecated columns
        -- Useful for migration tracking
        EXECUTE format('
            CREATE OR REPLACE VIEW public.performance_cycles_legacy_columns_status AS
            SELECT 
                pc.id,
                pc.name,
                pc.year,
                pc.status,
                -- Check if quarterly columns are populated
                CASE 
                    WHEN pc.q1_self_review_start IS NOT NULL THEN true 
                    ELSE false 
                END as has_q1_data,
                CASE 
                    WHEN pc.q2_self_review_start IS NOT NULL THEN true 
                    ELSE false 
                END as has_q2_data,
                CASE 
                    WHEN pc.q3_self_review_start IS NOT NULL THEN true 
                    ELSE false 
                END as has_q3_data,
                CASE 
                    WHEN pc.q4_self_review_start IS NOT NULL THEN true 
                    ELSE false 
                END as has_q4_data,
                -- Check if new tables have data
                (SELECT COUNT(*) > 0 FROM quarterly_cycles qc WHERE qc.performance_cycle_id = pc.id) as has_quarterly_cycles,
                (SELECT COUNT(*) > 0 FROM goals_quarterly_cycles gqc WHERE gqc.performance_cycle_id = pc.id) as has_goals_quarterly_cycles
            FROM performance_cycles pc;
        ');
        
        COMMENT ON VIEW public.performance_cycles_legacy_columns_status IS 
            'View to track migration status from legacy quarterly columns to new normalized tables';
        
        RAISE NOTICE 'View performance_cycles_legacy_columns_status created successfully.';
    ELSE
        RAISE NOTICE 'Quarterly columns do not exist. Skipping legacy columns status view creation.';
    END IF;
END $$;

-- =====================================================
-- STEP 4: Optional - Make columns nullable (if they aren't already)
-- This allows gradual migration without breaking existing data
-- =====================================================

-- Note: These columns are already nullable, so no ALTER needed
-- But we document that they should not be used for new cycles

-- =====================================================
-- STEP 5: Create a function to sync data from new tables back to legacy columns (if columns exist)
-- This helps maintain backward compatibility during transition
-- =====================================================

DO $$
DECLARE
    has_q1_cols BOOLEAN;
BEGIN
    -- Check if quarterly columns exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND table_name = 'performance_cycles' 
        AND column_name = 'q1_self_review_start'
    ) INTO has_q1_cols;
    
    -- Only create function if columns exist
    IF has_q1_cols THEN
        EXECUTE format('
            CREATE OR REPLACE FUNCTION public.sync_legacy_quarterly_columns()
            RETURNS void
            LANGUAGE plpgsql
            AS $func$
            DECLARE
                cycle_rec RECORD;
                qc_rec RECORD;
            BEGIN
                -- Sync quarterly_cycles data back to legacy columns
                -- This is a one-way sync: new tables -> legacy columns
                -- Only updates if legacy columns are NULL (doesn''t overwrite existing data)
                
                FOR cycle_rec IN SELECT id FROM performance_cycles LOOP
                    -- Q1
                    SELECT * INTO qc_rec FROM quarterly_cycles 
                    WHERE performance_cycle_id = cycle_rec.id AND quarter = 1;
                    
                    IF FOUND THEN
                        UPDATE performance_cycles
                        SET 
                            q1_self_review_start = COALESCE(q1_self_review_start, qc_rec.self_review_start_date),
                            q1_self_review_end = COALESCE(q1_self_review_end, qc_rec.self_review_end_date),
                            q1_manager_review_start = COALESCE(q1_manager_review_start, qc_rec.manager_review_start_date),
                            q1_manager_review_end = COALESCE(q1_manager_review_end, qc_rec.manager_review_end_date)
                        WHERE id = cycle_rec.id;
                    END IF;
                    
                    -- Q2
                    SELECT * INTO qc_rec FROM quarterly_cycles 
                    WHERE performance_cycle_id = cycle_rec.id AND quarter = 2;
                    
                    IF FOUND THEN
                        UPDATE performance_cycles
                        SET 
                            q2_self_review_start = COALESCE(q2_self_review_start, qc_rec.self_review_start_date),
                            q2_self_review_end = COALESCE(q2_self_review_end, qc_rec.self_review_end_date),
                            q2_manager_review_start = COALESCE(q2_manager_review_start, qc_rec.manager_review_start_date),
                            q2_manager_review_end = COALESCE(q2_manager_review_end, qc_rec.manager_review_end_date)
                        WHERE id = cycle_rec.id;
                    END IF;
                    
                    -- Q3
                    SELECT * INTO qc_rec FROM quarterly_cycles 
                    WHERE performance_cycle_id = cycle_rec.id AND quarter = 3;
                    
                    IF FOUND THEN
                        UPDATE performance_cycles
                        SET 
                            q3_self_review_start = COALESCE(q3_self_review_start, qc_rec.self_review_start_date),
                            q3_self_review_end = COALESCE(q3_self_review_end, qc_rec.self_review_end_date),
                            q3_manager_review_start = COALESCE(q3_manager_review_start, qc_rec.manager_review_start_date),
                            q3_manager_review_end = COALESCE(q3_manager_review_end, qc_rec.manager_review_end_date)
                        WHERE id = cycle_rec.id;
                    END IF;
                    
                    -- Q4
                    SELECT * INTO qc_rec FROM quarterly_cycles 
                    WHERE performance_cycle_id = cycle_rec.id AND quarter = 4;
                    
                    IF FOUND THEN
                        UPDATE performance_cycles
                        SET 
                            q4_self_review_start = COALESCE(q4_self_review_start, qc_rec.self_review_start_date),
                            q4_self_review_end = COALESCE(q4_self_review_end, qc_rec.self_review_end_date),
                            q4_manager_review_start = COALESCE(q4_manager_review_start, qc_rec.manager_review_start_date),
                            q4_manager_review_end = COALESCE(q4_manager_review_end, qc_rec.manager_review_end_date)
                        WHERE id = cycle_rec.id;
                    END IF;
                END LOOP;
            END;
            $func$;
        ');
        
        COMMENT ON FUNCTION public.sync_legacy_quarterly_columns() IS 
            'Syncs data from quarterly_cycles back to legacy columns for backward compatibility. 
             Only updates NULL values, does not overwrite existing data.';
        
        RAISE NOTICE 'Function sync_legacy_quarterly_columns() created successfully.';
    ELSE
        RAISE NOTICE 'Quarterly columns do not exist. Skipping sync function creation.';
    END IF;
END $$;

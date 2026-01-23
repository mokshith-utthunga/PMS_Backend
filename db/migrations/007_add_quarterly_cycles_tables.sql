-- Migration: Add quarterly_cycles and goals_quarterly_cycles tables
-- This normalizes quarterly cycle data from performance_cycles.q1_* columns
-- Date: 2024

-- Step 1: Create quarterly_cycles table
CREATE TABLE IF NOT EXISTS public.quarterly_cycles (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    performance_cycle_id uuid NOT NULL,
    quarter integer NOT NULL CHECK (quarter BETWEEN 1 AND 4),
    
    quarter_start_date date NOT NULL,
    quarter_end_date date NOT NULL,
    
    self_review_start_date date,
    self_review_end_date date,
    
    manager_review_start_date date NOT NULL,
    manager_review_end_date date NOT NULL,
    
    status cycle_status NOT NULL DEFAULT 'draft',
    
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    
    CONSTRAINT quarterly_cycles_pkey PRIMARY KEY (id),
    CONSTRAINT quarterly_cycles_unique UNIQUE (performance_cycle_id, quarter),
    CONSTRAINT quarterly_cycles_performance_cycle_fkey
        FOREIGN KEY (performance_cycle_id)
        REFERENCES public.performance_cycles (id)
        ON DELETE CASCADE
);

-- Step 2: Create goals_quarterly_cycles table
-- Note: This table is INDEPENDENT from quarterly_cycles
-- Goals and evaluations can have different timelines and can exist independently
-- Both tables link to performance_cycles via performance_cycle_id and quarter
CREATE TABLE IF NOT EXISTS public.goals_quarterly_cycles (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    performance_cycle_id uuid NOT NULL,
    quarter integer NOT NULL CHECK (quarter BETWEEN 1 AND 4),
    
    quarterly_start_date date NOT NULL,
    quarterly_end_date date NOT NULL,
    
    goal_submission_start_date date NOT NULL,
    goal_submission_end_date date NOT NULL,
    
    manager_review_start_date date NOT NULL,
    manager_review_end_date date NOT NULL,
    
    allow_late_goal_submission boolean NOT NULL DEFAULT false,
    
    status cycle_status NOT NULL DEFAULT 'draft',
    
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    
    CONSTRAINT goals_quarterly_cycles_pkey PRIMARY KEY (id),
    CONSTRAINT goals_quarterly_cycles_unique UNIQUE (performance_cycle_id, quarter),
    CONSTRAINT goals_qc_performance_cycle_fkey
        FOREIGN KEY (performance_cycle_id)
        REFERENCES public.performance_cycles (id)
        ON DELETE CASCADE
);

-- Step 3: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_quarterly_cycles_performance_cycle_id 
    ON public.quarterly_cycles(performance_cycle_id);

CREATE INDEX IF NOT EXISTS idx_quarterly_cycles_quarter 
    ON public.quarterly_cycles(quarter);

CREATE INDEX IF NOT EXISTS idx_quarterly_cycles_status 
    ON public.quarterly_cycles(status);

CREATE INDEX IF NOT EXISTS idx_goals_quarterly_cycles_performance_cycle_id 
    ON public.goals_quarterly_cycles(performance_cycle_id);

-- Removed index on quarterly_cycle_id - goals_quarterly_cycles is independent from quarterly_cycles

CREATE INDEX IF NOT EXISTS idx_goals_quarterly_cycles_quarter 
    ON public.goals_quarterly_cycles(quarter);

CREATE INDEX IF NOT EXISTS idx_goals_quarterly_cycles_status 
    ON public.goals_quarterly_cycles(status);

-- Step 4: Backfill data from existing performance_cycles.q1_* columns (if columns exist)
-- This migration script will populate quarterly_cycles from existing q1-q4 columns
-- Note: Uses dynamic SQL to handle cases where columns may not exist

DO $$
DECLARE
    cycle_id UUID;
    cycle_year INTEGER;
    quarter_num INTEGER;
    q_start DATE;
    q_end DATE;
    qc_id UUID;
    has_q1_cols BOOLEAN;
    has_goal_cols BOOLEAN;
    goal_start DATE;
    goal_end DATE;
    goal_approval DATE;
    allow_late BOOLEAN;
    q1_self_start DATE;
    q1_self_end DATE;
    q1_mgr_start DATE;
    q1_mgr_end DATE;
    q2_self_start DATE;
    q2_self_end DATE;
    q2_mgr_start DATE;
    q2_mgr_end DATE;
    q3_self_start DATE;
    q3_self_end DATE;
    q3_mgr_start DATE;
    q3_mgr_end DATE;
    q4_self_start DATE;
    q4_self_end DATE;
    q4_mgr_start DATE;
    q4_mgr_end DATE;
BEGIN
    -- Check if quarterly columns exist in performance_cycles
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND table_name = 'performance_cycles' 
        AND column_name = 'q1_self_review_start'
    ) INTO has_q1_cols;
    
    -- If columns don't exist, skip backfill (they may have been removed already)
    IF NOT has_q1_cols THEN
        RAISE NOTICE 'Quarterly columns (q1_*, q2_*, q3_*, q4_*) do not exist in performance_cycles. Skipping data backfill.';
        RAISE NOTICE 'If you need to populate quarterly_cycles, do it manually or through the application.';
        RETURN;
    END IF;
    
    -- Check if goal columns exist
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND table_name = 'performance_cycles' 
        AND column_name = 'goal_submission_start'
    ) INTO has_goal_cols;
    
    -- Loop through all performance cycles using dynamic SQL
    FOR cycle_id, cycle_year IN 
        SELECT id, year FROM performance_cycles
    LOOP
        -- Use EXECUTE to safely access columns that may not exist
        BEGIN
            -- Get quarterly data using dynamic SQL
            EXECUTE format('
                SELECT q1_self_review_start, q1_self_review_end, q1_manager_review_start, q1_manager_review_end,
                       q2_self_review_start, q2_self_review_end, q2_manager_review_start, q2_manager_review_end,
                       q3_self_review_start, q3_self_review_end, q3_manager_review_start, q3_manager_review_end,
                       q4_self_review_start, q4_self_review_end, q4_manager_review_start, q4_manager_review_end
                FROM performance_cycles WHERE id = $1'
            ) USING cycle_id
            INTO q1_self_start, q1_self_end, q1_mgr_start, q1_mgr_end,
                 q2_self_start, q2_self_end, q2_mgr_start, q2_mgr_end,
                 q3_self_start, q3_self_end, q3_mgr_start, q3_mgr_end,
                 q4_self_start, q4_self_end, q4_mgr_start, q4_mgr_end;
            
            -- Get goal data if columns exist
            IF has_goal_cols THEN
                BEGIN
                    EXECUTE format('
                        SELECT goal_submission_start, goal_submission_end, goal_approval_end, 
                               COALESCE(allow_late_goal_submission, false)
                        FROM performance_cycles WHERE id = $1'
                    ) USING cycle_id
                    INTO goal_start, goal_end, goal_approval, allow_late;
                EXCEPTION WHEN OTHERS THEN
                    -- If goal columns don't exist, use defaults
                    goal_start := NULL;
                    goal_end := NULL;
                    goal_approval := NULL;
                    allow_late := false;
                END;
            ELSE
                goal_start := NULL;
                goal_end := NULL;
                goal_approval := NULL;
                allow_late := false;
            END IF;
            
            -- Process Q1
            IF q1_mgr_start IS NOT NULL THEN
                quarter_num := 1;
                q_start := DATE(cycle_year || '-01-01');
                q_end := DATE(cycle_year || '-03-31');
                
                INSERT INTO quarterly_cycles (
                    performance_cycle_id, quarter,
                    quarter_start_date, quarter_end_date,
                    self_review_start_date, self_review_end_date,
                    manager_review_start_date, manager_review_end_date,
                    status, created_at, updated_at
                )
                VALUES (
                    cycle_id, quarter_num,
                    q_start, q_end,
                    q1_self_start, q1_self_end,
                    q1_mgr_start, q1_mgr_end,
                    'draft', now(), now()
                )
                ON CONFLICT (performance_cycle_id, quarter) DO UPDATE SET updated_at = now();
                
                -- Create goals_quarterly_cycles entry (independent from quarterly_cycles)
                -- Goals can exist independently - no need to wait for quarterly_cycles
                INSERT INTO goals_quarterly_cycles (
                    performance_cycle_id, quarter,
                    quarterly_start_date, quarterly_end_date,
                    goal_submission_start_date, goal_submission_end_date,
                    manager_review_start_date, manager_review_end_date,
                    allow_late_goal_submission, status, created_at, updated_at
                )
                VALUES (
                    cycle_id, quarter_num,
                    q_start, q_end,
                    COALESCE(goal_start, q_start), COALESCE(goal_end, q_start + INTERVAL '30 days'),
                    COALESCE(goal_approval, q_start + INTERVAL '45 days'), COALESCE(goal_approval, q_start + INTERVAL '45 days'),
                    allow_late, 'draft', now(), now()
                )
                ON CONFLICT (performance_cycle_id, quarter) DO NOTHING;
            END IF;
            
            -- Process Q2
            IF q2_mgr_start IS NOT NULL THEN
                quarter_num := 2;
                q_start := DATE(cycle_year || '-04-01');
                q_end := DATE(cycle_year || '-06-30');
                
                INSERT INTO quarterly_cycles (
                    performance_cycle_id, quarter,
                    quarter_start_date, quarter_end_date,
                    self_review_start_date, self_review_end_date,
                    manager_review_start_date, manager_review_end_date,
                    status, created_at, updated_at
                )
                VALUES (
                    cycle_id, quarter_num,
                    q_start, q_end,
                    q2_self_start, q2_self_end,
                    q2_mgr_start, q2_mgr_end,
                    'draft', now(), now()
                )
                ON CONFLICT (performance_cycle_id, quarter) DO UPDATE SET updated_at = now();
                
                -- Create goals_quarterly_cycles entry (independent from quarterly_cycles)
                -- Goals can exist independently - no need to wait for quarterly_cycles
                INSERT INTO goals_quarterly_cycles (
                    performance_cycle_id, quarter,
                    quarterly_start_date, quarterly_end_date,
                    goal_submission_start_date, goal_submission_end_date,
                    manager_review_start_date, manager_review_end_date,
                    allow_late_goal_submission, status, created_at, updated_at
                )
                VALUES (
                    cycle_id, quarter_num,
                    q_start, q_end,
                    COALESCE(goal_start, q_start), COALESCE(goal_end, q_start + INTERVAL '30 days'),
                    COALESCE(goal_approval, q_start + INTERVAL '45 days'), COALESCE(goal_approval, q_start + INTERVAL '45 days'),
                    allow_late, 'draft', now(), now()
                )
                ON CONFLICT (performance_cycle_id, quarter) DO NOTHING;
            END IF;
            
            -- Process Q3
            IF q3_mgr_start IS NOT NULL THEN
                quarter_num := 3;
                q_start := DATE(cycle_year || '-07-01');
                q_end := DATE(cycle_year || '-09-30');
                
                INSERT INTO quarterly_cycles (
                    performance_cycle_id, quarter,
                    quarter_start_date, quarter_end_date,
                    self_review_start_date, self_review_end_date,
                    manager_review_start_date, manager_review_end_date,
                    status, created_at, updated_at
                )
                VALUES (
                    cycle_id, quarter_num,
                    q_start, q_end,
                    q3_self_start, q3_self_end,
                    q3_mgr_start, q3_mgr_end,
                    'draft', now(), now()
                )
                ON CONFLICT (performance_cycle_id, quarter) DO UPDATE SET updated_at = now();
                
                -- Create goals_quarterly_cycles entry (independent from quarterly_cycles)
                -- Goals can exist independently - no need to wait for quarterly_cycles
                INSERT INTO goals_quarterly_cycles (
                    performance_cycle_id, quarter,
                    quarterly_start_date, quarterly_end_date,
                    goal_submission_start_date, goal_submission_end_date,
                    manager_review_start_date, manager_review_end_date,
                    allow_late_goal_submission, status, created_at, updated_at
                )
                VALUES (
                    cycle_id, quarter_num,
                    q_start, q_end,
                    COALESCE(goal_start, q_start), COALESCE(goal_end, q_start + INTERVAL '30 days'),
                    COALESCE(goal_approval, q_start + INTERVAL '45 days'), COALESCE(goal_approval, q_start + INTERVAL '45 days'),
                    allow_late, 'draft', now(), now()
                )
                ON CONFLICT (performance_cycle_id, quarter) DO NOTHING;
            END IF;
            
            -- Process Q4
            IF q4_mgr_start IS NOT NULL THEN
                quarter_num := 4;
                q_start := DATE(cycle_year || '-10-01');
                q_end := DATE(cycle_year || '-12-31');
                
                INSERT INTO quarterly_cycles (
                    performance_cycle_id, quarter,
                    quarter_start_date, quarter_end_date,
                    self_review_start_date, self_review_end_date,
                    manager_review_start_date, manager_review_end_date,
                    status, created_at, updated_at
                )
                VALUES (
                    cycle_id, quarter_num,
                    q_start, q_end,
                    q4_self_start, q4_self_end,
                    q4_mgr_start, q4_mgr_end,
                    'draft', now(), now()
                )
                ON CONFLICT (performance_cycle_id, quarter) DO UPDATE SET updated_at = now();
                
                -- Create goals_quarterly_cycles entry (independent from quarterly_cycles)
                -- Goals can exist independently - no need to wait for quarterly_cycles
                INSERT INTO goals_quarterly_cycles (
                    performance_cycle_id, quarter,
                    quarterly_start_date, quarterly_end_date,
                    goal_submission_start_date, goal_submission_end_date,
                    manager_review_start_date, manager_review_end_date,
                    allow_late_goal_submission, status, created_at, updated_at
                )
                VALUES (
                    cycle_id, quarter_num,
                    q_start, q_end,
                    COALESCE(goal_start, q_start), COALESCE(goal_end, q_start + INTERVAL '30 days'),
                    COALESCE(goal_approval, q_start + INTERVAL '45 days'), COALESCE(goal_approval, q_start + INTERVAL '45 days'),
                    allow_late, 'draft', now(), now()
                )
                ON CONFLICT (performance_cycle_id, quarter) DO NOTHING;
            END IF;
            
        EXCEPTION WHEN OTHERS THEN
            -- If columns don't exist, skip this cycle
            RAISE NOTICE 'Skipping cycle % - columns may not exist: %', cycle_id, SQLERRM;
        END; -- End of exception handler for this cycle
    END LOOP; -- End of FOR loop
END $$;

-- Step 5: Add comments for documentation
COMMENT ON TABLE quarterly_cycles IS 'Stores quarterly evaluation cycles (replaces q1_*, q2_*, q3_*, q4_* columns in performance_cycles)';
COMMENT ON TABLE goals_quarterly_cycles IS 'Stores quarterly goal submission and approval timelines, separate from evaluation cycles';
COMMENT ON COLUMN quarterly_cycles.quarter IS 'Quarter number: 1 (Q1), 2 (Q2), 3 (Q3), or 4 (Q4)';
COMMENT ON COLUMN goals_quarterly_cycles.quarter IS 'Quarter number: 1 (Q1), 2 (Q2), 3 (Q3), or 4 (Q4)';
COMMENT ON COLUMN goals_quarterly_cycles.allow_late_goal_submission IS 'Whether late goal submission is allowed for this quarter';

-- Migration: Add Mid-Quarter Employee Transitions Support
-- This migration adds support for handling employee promotions/project changes mid-quarter
-- Run after: 020_add_admin_override_tracking.sql

-- Create ENUM type for transition types
DO $$ BEGIN
    CREATE TYPE transition_type AS ENUM ('promotion', 'project_change', 'role_change');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create ENUM type for period types
DO $$ BEGIN
    CREATE TYPE period_type AS ENUM ('full_quarter', 'pre_transition', 'post_transition');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 1. Create employee_quarter_transitions table
CREATE TABLE IF NOT EXISTS employee_quarter_transitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    cycle_id UUID NOT NULL REFERENCES performance_cycles(id) ON DELETE CASCADE,
    quarter INTEGER NOT NULL CHECK (quarter >= 1 AND quarter <= 4),
    
    -- Transition details
    transition_type transition_type NOT NULL,
    transition_date DATE NOT NULL,
    old_manager_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    new_manager_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    old_department TEXT,
    new_department TEXT,
    old_project TEXT,
    new_project TEXT,
    old_grade TEXT,
    new_grade TEXT,
    
    -- Status tracking
    old_period_closed BOOLEAN NOT NULL DEFAULT false,
    old_period_reviewed BOOLEAN NOT NULL DEFAULT false,
    new_period_goals_set BOOLEAN NOT NULL DEFAULT false,
    new_period_approved BOOLEAN NOT NULL DEFAULT false,
    
    -- Metadata
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Ensure one transition per employee per quarter
    UNIQUE(employee_id, cycle_id, quarter)
);

CREATE INDEX IF NOT EXISTS idx_employee_quarter_transitions_employee_cycle 
    ON employee_quarter_transitions(employee_id, cycle_id);
CREATE INDEX IF NOT EXISTS idx_employee_quarter_transitions_quarter 
    ON employee_quarter_transitions(quarter);
CREATE INDEX IF NOT EXISTS idx_employee_quarter_transitions_transition_date 
    ON employee_quarter_transitions(transition_date);

-- 2. Add period tracking to kras table
ALTER TABLE kras 
ADD COLUMN IF NOT EXISTS period_type period_type DEFAULT 'full_quarter'::period_type,
ADD COLUMN IF NOT EXISTS transition_id UUID REFERENCES employee_quarter_transitions(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS period_start_date DATE,
ADD COLUMN IF NOT EXISTS period_end_date DATE;

CREATE INDEX IF NOT EXISTS idx_kras_period_type 
    ON kras(period_type, transition_id);
CREATE INDEX IF NOT EXISTS idx_kras_transition_id 
    ON kras(transition_id);

-- 3. Add period tracking to goals table
ALTER TABLE goals
ADD COLUMN IF NOT EXISTS period_type period_type DEFAULT 'full_quarter'::period_type,
ADD COLUMN IF NOT EXISTS transition_id UUID REFERENCES employee_quarter_transitions(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS period_start_date DATE,
ADD COLUMN IF NOT EXISTS period_end_date DATE;

CREATE INDEX IF NOT EXISTS idx_goals_period_type 
    ON goals(period_type, transition_id);
CREATE INDEX IF NOT EXISTS idx_goals_transition_id 
    ON goals(transition_id);

-- 4. Modify quarterly_self_reviews table
-- Drop existing unique constraint if it exists
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'quarterly_self_reviews_employee_id_cycle_id_quarter_key'
    ) THEN
        ALTER TABLE quarterly_self_reviews 
        DROP CONSTRAINT quarterly_self_reviews_employee_id_cycle_id_quarter_key;
    END IF;
END $$;

-- Add period tracking columns
ALTER TABLE quarterly_self_reviews
ADD COLUMN IF NOT EXISTS period_type period_type DEFAULT 'full_quarter'::period_type,
ADD COLUMN IF NOT EXISTS transition_id UUID REFERENCES employee_quarter_transitions(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS period_start_date DATE,
ADD COLUMN IF NOT EXISTS period_end_date DATE;

-- Create new unique constraint allowing multiple reviews per quarter (one per period)
-- Use expression index to handle NULL transition_id values
CREATE UNIQUE INDEX IF NOT EXISTS quarterly_self_reviews_employee_cycle_quarter_period_idx 
    ON quarterly_self_reviews(employee_id, cycle_id, quarter, period_type, (COALESCE(transition_id, '00000000-0000-0000-0000-000000000000'::uuid)));

CREATE INDEX IF NOT EXISTS idx_quarterly_self_reviews_period_type 
    ON quarterly_self_reviews(period_type, transition_id);

-- 5. Modify quarterly_manager_reviews table
-- Drop existing unique constraint if it exists
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'quarterly_manager_reviews_employee_id_cycle_id_quarter_key'
    ) THEN
        ALTER TABLE quarterly_manager_reviews 
        DROP CONSTRAINT quarterly_manager_reviews_employee_id_cycle_id_quarter_key;
    END IF;
END $$;

-- Add period tracking columns
ALTER TABLE quarterly_manager_reviews
ADD COLUMN IF NOT EXISTS period_type period_type DEFAULT 'full_quarter'::period_type,
ADD COLUMN IF NOT EXISTS transition_id UUID REFERENCES employee_quarter_transitions(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS period_start_date DATE,
ADD COLUMN IF NOT EXISTS period_end_date DATE,
ADD COLUMN IF NOT EXISTS is_old_manager_review BOOLEAN DEFAULT false;

-- Create new unique constraint
-- Use expression index to handle NULL transition_id values
CREATE UNIQUE INDEX IF NOT EXISTS quarterly_manager_reviews_employee_cycle_quarter_period_idx 
    ON quarterly_manager_reviews(employee_id, cycle_id, quarter, period_type, (COALESCE(transition_id, '00000000-0000-0000-0000-000000000000'::uuid)));

CREATE INDEX IF NOT EXISTS idx_quarterly_manager_reviews_period_type 
    ON quarterly_manager_reviews(period_type, transition_id);

-- 6. Create quarterly_period_ratings table
CREATE TABLE IF NOT EXISTS quarterly_period_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    cycle_id UUID NOT NULL REFERENCES performance_cycles(id) ON DELETE CASCADE,
    quarter INTEGER NOT NULL CHECK (quarter >= 1 AND quarter <= 4),
    transition_id UUID REFERENCES employee_quarter_transitions(id) ON DELETE CASCADE,
    
    -- Period details
    period_type period_type NOT NULL,
    period_start_date DATE NOT NULL,
    period_end_date DATE NOT NULL,
    period_days INTEGER NOT NULL,
    
    -- Ratings
    weighted_avg_rating NUMERIC(5, 3),
    manager_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    
    -- Status
    is_final BOOLEAN NOT NULL DEFAULT false,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create unique index for quarterly_period_ratings (using COALESCE for NULL handling)
-- Use expression index to handle NULL transition_id values
CREATE UNIQUE INDEX IF NOT EXISTS quarterly_period_ratings_unique_idx 
    ON quarterly_period_ratings(employee_id, cycle_id, quarter, period_type, (COALESCE(transition_id, '00000000-0000-0000-0000-000000000000'::uuid)));

CREATE INDEX IF NOT EXISTS idx_quarterly_period_ratings_employee_cycle 
    ON quarterly_period_ratings(employee_id, cycle_id);
CREATE INDEX IF NOT EXISTS idx_quarterly_period_ratings_transition 
    ON quarterly_period_ratings(transition_id);
CREATE INDEX IF NOT EXISTS idx_quarterly_period_ratings_period_type 
    ON quarterly_period_ratings(period_type);

-- 7. Modify manager_evaluations table - Add period-specific rating columns for all quarters
ALTER TABLE manager_evaluations
ADD COLUMN IF NOT EXISTS q1_pre_transition_rating NUMERIC(5, 3),
ADD COLUMN IF NOT EXISTS q1_post_transition_rating NUMERIC(5, 3),
ADD COLUMN IF NOT EXISTS q1_transition_id UUID REFERENCES employee_quarter_transitions(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS q2_pre_transition_rating NUMERIC(5, 3),
ADD COLUMN IF NOT EXISTS q2_post_transition_rating NUMERIC(5, 3),
ADD COLUMN IF NOT EXISTS q2_transition_id UUID REFERENCES employee_quarter_transitions(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS q3_pre_transition_rating NUMERIC(5, 3),
ADD COLUMN IF NOT EXISTS q3_post_transition_rating NUMERIC(5, 3),
ADD COLUMN IF NOT EXISTS q3_transition_id UUID REFERENCES employee_quarter_transitions(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS q4_pre_transition_rating NUMERIC(5, 3),
ADD COLUMN IF NOT EXISTS q4_post_transition_rating NUMERIC(5, 3),
ADD COLUMN IF NOT EXISTS q4_transition_id UUID REFERENCES employee_quarter_transitions(id) ON DELETE SET NULL;

-- 8. Modify normalized_ratings table
-- Drop existing unique constraint if it exists
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'normalized_ratings_employee_id_performance_cycle_id_quarter_key'
    ) THEN
        ALTER TABLE normalized_ratings 
        DROP CONSTRAINT normalized_ratings_employee_id_performance_cycle_id_quarter_key;
    END IF;
END $$;

ALTER TABLE normalized_ratings
ADD COLUMN IF NOT EXISTS period_type period_type DEFAULT 'full_quarter'::period_type,
ADD COLUMN IF NOT EXISTS transition_id UUID REFERENCES employee_quarter_transitions(id) ON DELETE SET NULL;

-- Create new unique constraint
-- Use expression index to handle NULL transition_id values
CREATE UNIQUE INDEX IF NOT EXISTS normalized_ratings_employee_cycle_quarter_period_idx 
    ON normalized_ratings(employee_id, performance_cycle_id, quarter, period_type, (COALESCE(transition_id, '00000000-0000-0000-0000-000000000000'::uuid)));

CREATE INDEX IF NOT EXISTS idx_normalized_ratings_period_type 
    ON normalized_ratings(period_type, transition_id);

-- 9. Create quarterly_final_ratings table
CREATE TABLE IF NOT EXISTS quarterly_final_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    cycle_id UUID NOT NULL REFERENCES performance_cycles(id) ON DELETE CASCADE,
    quarter INTEGER NOT NULL CHECK (quarter >= 1 AND quarter <= 4),
    transition_id UUID REFERENCES employee_quarter_transitions(id) ON DELETE SET NULL,
    
    -- Period ratings
    pre_transition_rating NUMERIC(5, 3),
    post_transition_rating NUMERIC(5, 3),
    pre_transition_days INTEGER,
    post_transition_days INTEGER,
    
    -- Final calculated rating
    final_quarterly_rating NUMERIC(5, 3) NOT NULL,
    
    -- Calculation method used
    calculation_method TEXT NOT NULL CHECK (calculation_method IN ('simple_average', 'time_weighted')),
    
    -- Status
    is_final BOOLEAN NOT NULL DEFAULT false,
    
    -- Metadata
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    calculated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    UNIQUE(employee_id, cycle_id, quarter)
);

CREATE INDEX IF NOT EXISTS idx_quarterly_final_ratings_employee_cycle 
    ON quarterly_final_ratings(employee_id, cycle_id);
CREATE INDEX IF NOT EXISTS idx_quarterly_final_ratings_transition 
    ON quarterly_final_ratings(transition_id);

-- Add comments for documentation
COMMENT ON TABLE employee_quarter_transitions IS 'Tracks mid-quarter employee transitions (promotions, project changes, role changes)';
COMMENT ON TABLE quarterly_period_ratings IS 'Stores calculated ratings for pre and post-transition periods';
COMMENT ON TABLE quarterly_final_ratings IS 'Stores final combined quarterly rating after merging pre and post-transition ratings';
COMMENT ON COLUMN kras.period_type IS 'Identifies if KRA belongs to full quarter, pre-transition, or post-transition period';
COMMENT ON COLUMN goals.period_type IS 'Identifies if goal belongs to full quarter, pre-transition, or post-transition period';
COMMENT ON COLUMN quarterly_self_reviews.period_type IS 'Identifies if review is for full quarter, pre-transition, or post-transition period';
COMMENT ON COLUMN quarterly_manager_reviews.period_type IS 'Identifies if review is for full quarter, pre-transition, or post-transition period';
COMMENT ON COLUMN quarterly_manager_reviews.is_old_manager_review IS 'Flag to identify if this is the old manager reviewing pre-transition period';

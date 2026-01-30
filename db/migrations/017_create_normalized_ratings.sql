-- Migration: Create normalized_ratings table for Box-Cox normalization workflow
-- This table stores normalized ratings with status-based workflow

-- Create ENUM type for normalized rating status
DO $$ BEGIN
    CREATE TYPE normalized_rating_status AS ENUM (
        'DRAFT',
        'SENT_TO_MANAGER',
        'ACCEPTED',
        'REJECTED',
        'PUBLISHED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create normalized_ratings table
CREATE TABLE IF NOT EXISTS normalized_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    manager_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    performance_cycle_id UUID NOT NULL REFERENCES performance_cycles(id) ON DELETE CASCADE,
    quarter INTEGER NOT NULL CHECK (quarter >= 1 AND quarter <= 4),
    raw_rating NUMERIC(3, 2) NOT NULL,
    boxcox_manager_level_rating NUMERIC(3, 2),
    boxcox_grade_level_rating NUMERIC(3, 2),
    final_normalized_rating NUMERIC(3, 2),
    status normalized_rating_status NOT NULL DEFAULT 'DRAFT',
    updated_by_hr UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(employee_id, performance_cycle_id, quarter)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_normalized_ratings_cycle_quarter_status 
    ON normalized_ratings(performance_cycle_id, quarter, status);
CREATE INDEX IF NOT EXISTS idx_normalized_ratings_manager_quarter 
    ON normalized_ratings(manager_id, quarter);
CREATE INDEX IF NOT EXISTS idx_normalized_ratings_employee 
    ON normalized_ratings(employee_id);
CREATE INDEX IF NOT EXISTS idx_normalized_ratings_status 
    ON normalized_ratings(status);

-- Add comments
COMMENT ON TABLE normalized_ratings IS 'Stores Box-Cox normalized ratings with HR-Manager validation workflow';
COMMENT ON COLUMN normalized_ratings.raw_rating IS 'Original manager-submitted rating';
COMMENT ON COLUMN normalized_ratings.boxcox_manager_level_rating IS 'Normalized rating within manager scope';
COMMENT ON COLUMN normalized_ratings.boxcox_grade_level_rating IS 'Normalized rating within grade/band scope';
COMMENT ON COLUMN normalized_ratings.final_normalized_rating IS 'Combined normalized rating (weighted average)';
COMMENT ON COLUMN normalized_ratings.status IS 'Workflow status: DRAFT -> SENT_TO_MANAGER -> ACCEPTED/REJECTED -> PUBLISHED';

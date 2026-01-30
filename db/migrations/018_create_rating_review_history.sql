-- Migration: Create rating_review_history table for audit trail
-- This table tracks all actions in the normalized rating workflow

-- Create ENUM type for review actions
DO $$ BEGIN
    CREATE TYPE rating_review_action AS ENUM (
        'SEND',
        'ACCEPT',
        'REJECT',
        'EDIT',
        'PUBLISH'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create rating_review_history table
CREATE TABLE IF NOT EXISTS rating_review_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    quarter INTEGER NOT NULL CHECK (quarter >= 1 AND quarter <= 4),
    cycle_id UUID NOT NULL REFERENCES performance_cycles(id) ON DELETE CASCADE,
    old_value NUMERIC(3, 2),
    new_value NUMERIC(3, 2),
    action rating_review_action NOT NULL,
    acted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    acted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_rating_review_history_employee_cycle_quarter 
    ON rating_review_history(employee_id, cycle_id, quarter);
CREATE INDEX IF NOT EXISTS idx_rating_review_history_acted_by 
    ON rating_review_history(acted_by);
CREATE INDEX IF NOT EXISTS idx_rating_review_history_acted_at 
    ON rating_review_history(acted_at);

-- Add comments
COMMENT ON TABLE rating_review_history IS 'Audit trail for normalized rating workflow actions';
COMMENT ON COLUMN rating_review_history.action IS 'Action taken: SEND, ACCEPT, REJECT, EDIT, PUBLISH';

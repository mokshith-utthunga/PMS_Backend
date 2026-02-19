-- Migration: Create normalization_runs table for audit trail
-- This table tracks each normalization run with parameters and results

CREATE TABLE IF NOT EXISTS normalization_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    performance_cycle_id UUID NOT NULL REFERENCES performance_cycles(id) ON DELETE CASCADE,
    quarter INTEGER NOT NULL CHECK (quarter >= 1 AND quarter <= 4),
    run_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    total_employees INTEGER NOT NULL DEFAULT 0,
    processed_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    -- Parameters used for this run
    manager_weight NUMERIC(3, 2) DEFAULT 0.5,
    grade_weight NUMERIC(3, 2) DEFAULT 0.5,
    min_group_size INTEGER DEFAULT 3,
    use_winsorization BOOLEAN DEFAULT true,
    winsorization_percentile_low NUMERIC(3, 1) DEFAULT 5.0,
    winsorization_percentile_high NUMERIC(3, 1) DEFAULT 95.0,
    max_change_from_raw NUMERIC(3, 2) DEFAULT 2.0,
    -- Results summary
    avg_raw_rating NUMERIC(5, 3),
    avg_normalized_rating NUMERIC(5, 3),
    min_raw_rating NUMERIC(5, 3),
    max_raw_rating NUMERIC(5, 3),
    min_normalized_rating NUMERIC(5, 3),
    max_normalized_rating NUMERIC(5, 3),
    notes TEXT
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_normalization_runs_cycle_quarter 
    ON normalization_runs(performance_cycle_id, quarter);
CREATE INDEX IF NOT EXISTS idx_normalization_runs_run_at 
    ON normalization_runs(run_at DESC);

-- Add comments
COMMENT ON TABLE normalization_runs IS 'Audit trail for normalization runs with parameters and results';
COMMENT ON COLUMN normalization_runs.min_group_size IS 'Minimum group size required for full normalization (default 3)';
COMMENT ON COLUMN normalization_runs.use_winsorization IS 'Whether percentile clipping was applied to reduce outlier impact';
COMMENT ON COLUMN normalization_runs.max_change_from_raw IS 'Maximum allowed change from raw rating (safeguard)';

-- Migration: Add calibrated_rating column to normalized_ratings table
-- This enables bell curve calibration on top of normalized ratings

-- Add calibrated_rating column
ALTER TABLE normalized_ratings
ADD COLUMN IF NOT EXISTS calibrated_rating INTEGER CHECK (calibrated_rating >= 1 AND calibrated_rating <= 5);

-- Add comment
COMMENT ON COLUMN normalized_ratings.calibrated_rating IS 'Bell curve calibrated rating (1-5) based on final_normalized_rating, applied per grade. Only set after calibration phase. Quotas are configurable via default_calibration_quotas table.';

-- Create index for calibration queries
CREATE INDEX IF NOT EXISTS idx_normalized_ratings_calibrated_rating 
    ON normalized_ratings(calibrated_rating) 
    WHERE calibrated_rating IS NOT NULL;

-- Update default_calibration_quotas to match automatic calibration requirements
-- Default distribution: 5★ (5%), 4★ (20%), 3★ (50%), 2★ (20%), 1★ (5%)
-- Only update if table exists and values are different
DO $$
BEGIN
    -- Check if table exists and has old values
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'default_calibration_quotas') THEN
        -- Update existing values to match automatic calibration requirements
        UPDATE default_calibration_quotas SET percentage = 5 WHERE rating_value = 5;
        UPDATE default_calibration_quotas SET percentage = 20 WHERE rating_value = 4;
        UPDATE default_calibration_quotas SET percentage = 50 WHERE rating_value = 3;
        UPDATE default_calibration_quotas SET percentage = 20 WHERE rating_value = 2;
        UPDATE default_calibration_quotas SET percentage = 5 WHERE rating_value = 1;
        
        -- Insert missing ratings if they don't exist
        INSERT INTO default_calibration_quotas (rating_value, percentage)
        SELECT * FROM (VALUES (5, 5), (4, 20), (3, 50), (2, 20), (1, 5)) AS v(rating_value, percentage)
        WHERE NOT EXISTS (SELECT 1 FROM default_calibration_quotas WHERE rating_value = v.rating_value);
    END IF;
END $$;

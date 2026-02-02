-- Migration: Add normalized KPI and KRA ratings to normalized_ratings table
-- This enables KPI-level normalization where we normalize KPIs first, then recalculate KRA and overall ratings

-- Add columns to store normalized KPI and KRA ratings
ALTER TABLE normalized_ratings
ADD COLUMN IF NOT EXISTS normalized_kpi_ratings JSONB,
ADD COLUMN IF NOT EXISTS normalized_kra_ratings JSONB,
ADD COLUMN IF NOT EXISTS raw_kpi_ratings JSONB,
ADD COLUMN IF NOT EXISTS raw_kra_ratings JSONB;

-- Add comments
COMMENT ON COLUMN normalized_ratings.normalized_kpi_ratings IS 'JSONB array of normalized KPI ratings: [{"goal_id": "uuid", "raw_rating": 4.0, "normalized_manager": 3.8, "normalized_grade": 3.9, "final_normalized": 3.85}]';
COMMENT ON COLUMN normalized_ratings.normalized_kra_ratings IS 'JSONB array of normalized KRA ratings: [{"kra_id": "uuid", "raw_rating": 4.2, "normalized_manager": 4.0, "normalized_grade": 4.1, "final_normalized": 4.05}]';
COMMENT ON COLUMN normalized_ratings.raw_kpi_ratings IS 'JSONB array of raw KPI ratings before normalization: [{"goal_id": "uuid", "rating": 4.0, "weight": 30}]';
COMMENT ON COLUMN normalized_ratings.raw_kra_ratings IS 'JSONB array of raw KRA ratings (calculated from raw KPIs): [{"kra_id": "uuid", "rating": 4.2, "weight": 40}]';

-- Create index for JSONB queries
CREATE INDEX IF NOT EXISTS idx_normalized_ratings_kpi_ratings 
    ON normalized_ratings USING GIN (normalized_kpi_ratings);
CREATE INDEX IF NOT EXISTS idx_normalized_ratings_kra_ratings 
    ON normalized_ratings USING GIN (normalized_kra_ratings);

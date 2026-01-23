-- Migration: Add calibration column to kpi_templates and goals tables
-- This allows KPI-specific calibration rules for rating calculations

-- Step 1: Add calibration column to kpi_templates
ALTER TABLE kpi_templates 
ADD COLUMN IF NOT EXISTS calibration JSONB DEFAULT NULL;

-- Step 2: Add calibration column to goals (KPIs)
ALTER TABLE goals 
ADD COLUMN IF NOT EXISTS calibration JSONB DEFAULT NULL;

-- Step 3: Add comments for documentation
COMMENT ON COLUMN kpi_templates.calibration IS 'JSONB array of calibration rules: [{"threshold": 120, "rating": 5}, {"threshold": 110, "rating": 4}, ...]. Thresholds are percentages relative to target.';
COMMENT ON COLUMN goals.calibration IS 'JSONB array of calibration rules copied from template. Editable until manager approval, then locked.';

-- Step 4: Create index for calibration queries (optional, for performance)
CREATE INDEX IF NOT EXISTS idx_kpi_templates_calibration ON kpi_templates USING GIN (calibration) WHERE calibration IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_goals_calibration ON goals USING GIN (calibration) WHERE calibration IS NOT NULL;

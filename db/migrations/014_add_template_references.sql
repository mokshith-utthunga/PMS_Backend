-- Migration: Add template reference columns for traceability
-- This helps track which templates were used to create KRAs and KPIs

-- Step 1: Add kra_template_id to kras table
-- This tracks which KRA template was used to create this KRA (null if custom)
ALTER TABLE kras 
ADD COLUMN IF NOT EXISTS kra_template_id UUID REFERENCES kra_templates(id) ON DELETE SET NULL;

-- Step 2: Add kpi_template_id to goals table  
-- This tracks which KPI template was used to create this KPI (null if custom)
ALTER TABLE goals 
ADD COLUMN IF NOT EXISTS kpi_template_id UUID REFERENCES kpi_templates(id) ON DELETE SET NULL;

-- Step 3: Add comments for documentation
COMMENT ON COLUMN kras.kra_template_id IS 'Reference to the KRA template used to create this KRA. NULL if created as custom KRA.';
COMMENT ON COLUMN goals.kpi_template_id IS 'Reference to the KPI template used to create this KPI. NULL if created as custom KPI.';

-- Step 4: Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_kras_kra_template_id ON kras(kra_template_id) WHERE kra_template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_goals_kpi_template_id ON goals(kpi_template_id) WHERE kpi_template_id IS NOT NULL;

-- Step 5: Create a view for easy querying of goals with template info
CREATE OR REPLACE VIEW goals_with_templates AS
SELECT 
  g.*,
  kt.title as kpi_template_title,
  kt.calibration as template_calibration,
  krat.title as kra_template_title,
  k.title as kra_title,
  k.kra_template_id
FROM goals g
LEFT JOIN kras k ON g.kra_id = k.id
LEFT JOIN kpi_templates kt ON g.kpi_template_id = kt.id
LEFT JOIN kra_templates krat ON k.kra_template_id = krat.id;

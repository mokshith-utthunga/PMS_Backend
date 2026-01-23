-- Data Migration: Populate kra_template_id, kpi_template_id, and quarter values
-- This migrates existing data to use the new template reference columns

-- ============================================
-- Step 1: Update kra_template_id in kras table
-- Match KRAs with templates by title
-- ============================================
UPDATE kras k
SET kra_template_id = kt.id
FROM kra_templates kt
WHERE k.title = kt.title
  AND k.kra_template_id IS NULL;

-- Log how many KRAs were updated
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO updated_count FROM kras WHERE kra_template_id IS NOT NULL;
  RAISE NOTICE 'KRAs with template reference: %', updated_count;
END $$;

-- ============================================
-- Step 2: Update kpi_template_id in goals table
-- Match KPIs with templates by title
-- ============================================
UPDATE goals g
SET kpi_template_id = kt.id
FROM kpi_templates kt
WHERE g.title = kt.title
  AND g.goal_type = 'kpi'
  AND g.kpi_template_id IS NULL;

-- Log how many KPIs were updated
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO updated_count FROM goals WHERE kpi_template_id IS NOT NULL;
  RAISE NOTICE 'KPIs with template reference: %', updated_count;
END $$;

-- ============================================
-- Step 3: Update quarter in goals table
-- Copy quarter from the associated KRA
-- ============================================
UPDATE goals g
SET quarter = k.quarter
FROM kras k
WHERE g.kra_id = k.id
  AND g.quarter IS NULL
  AND k.quarter IS NOT NULL;

-- Log how many goals got quarter updated
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO updated_count FROM goals WHERE quarter IS NOT NULL;
  RAISE NOTICE 'Goals with quarter value: %', updated_count;
END $$;

-- ============================================
-- Step 4: Update calibration in goals from KPI templates
-- Copy calibration from template if goal has template ref but no calibration
-- ============================================
UPDATE goals g
SET calibration = kt.calibration
FROM kpi_templates kt
WHERE g.kpi_template_id = kt.id
  AND g.calibration IS NULL
  AND kt.calibration IS NOT NULL;

-- Log how many goals got calibration
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO updated_count FROM goals WHERE calibration IS NOT NULL;
  RAISE NOTICE 'Goals with calibration: %', updated_count;
END $$;

-- ============================================
-- Step 5: Summary Report
-- ============================================
DO $$
DECLARE
  total_kras INTEGER;
  kras_with_template INTEGER;
  total_kpis INTEGER;
  kpis_with_template INTEGER;
  kpis_with_calibration INTEGER;
  kpis_with_quarter INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_kras FROM kras;
  SELECT COUNT(*) INTO kras_with_template FROM kras WHERE kra_template_id IS NOT NULL;
  SELECT COUNT(*) INTO total_kpis FROM goals WHERE goal_type = 'kpi';
  SELECT COUNT(*) INTO kpis_with_template FROM goals WHERE kpi_template_id IS NOT NULL AND goal_type = 'kpi';
  SELECT COUNT(*) INTO kpis_with_calibration FROM goals WHERE calibration IS NOT NULL AND goal_type = 'kpi';
  SELECT COUNT(*) INTO kpis_with_quarter FROM goals WHERE quarter IS NOT NULL AND goal_type = 'kpi';
  
  RAISE NOTICE '';
  RAISE NOTICE '========== MIGRATION SUMMARY ==========';
  RAISE NOTICE 'KRAs: % total, % with template reference', total_kras, kras_with_template;
  RAISE NOTICE 'KPIs: % total, % with template reference', total_kpis, kpis_with_template;
  RAISE NOTICE 'KPIs with calibration: %', kpis_with_calibration;
  RAISE NOTICE 'KPIs with quarter: %', kpis_with_quarter;
  RAISE NOTICE '========================================';
END $$;

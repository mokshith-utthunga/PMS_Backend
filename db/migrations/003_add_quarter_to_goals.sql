-- Migration: Add quarter field to goals and kras tables
-- This migration adds quarterly support to goals and KRAs

BEGIN;

-- Step 1: Add quarter column to kras table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'kras' 
    AND column_name = 'quarter'
  ) THEN
    ALTER TABLE kras 
    ADD COLUMN quarter INTEGER CHECK (quarter >= 1 AND quarter <= 4);
    
    RAISE NOTICE 'Added quarter column to kras table';
  ELSE
    RAISE NOTICE 'quarter column already exists in kras table';
  END IF;
END $$;

-- Step 2: Add quarter column to goals table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goals' 
    AND column_name = 'quarter'
  ) THEN
    ALTER TABLE goals 
    ADD COLUMN quarter INTEGER CHECK (quarter >= 1 AND quarter <= 4);
    
    RAISE NOTICE 'Added quarter column to goals table';
  ELSE
    RAISE NOTICE 'quarter column already exists in goals table';
  END IF;
END $$;

-- Step 3: Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_kras_quarter ON kras(quarter);
CREATE INDEX IF NOT EXISTS idx_goals_quarter ON goals(quarter);

-- Step 4: Migrate existing KRAs - assign quarter based on created_at date
-- Q1: Jan-Mar, Q2: Apr-Jun, Q3: Jul-Sep, Q4: Oct-Dec
UPDATE kras
SET quarter = CASE 
    WHEN EXTRACT(MONTH FROM created_at) BETWEEN 1 AND 3 THEN 1
    WHEN EXTRACT(MONTH FROM created_at) BETWEEN 4 AND 6 THEN 2
    WHEN EXTRACT(MONTH FROM created_at) BETWEEN 7 AND 9 THEN 3
    ELSE 4
END
WHERE quarter IS NULL;

-- Step 5: Migrate existing goals/KPIs - assign quarter based on created_at date
UPDATE goals
SET quarter = CASE 
    WHEN EXTRACT(MONTH FROM created_at) BETWEEN 1 AND 3 THEN 1
    WHEN EXTRACT(MONTH FROM created_at) BETWEEN 4 AND 6 THEN 2
    WHEN EXTRACT(MONTH FROM created_at) BETWEEN 7 AND 9 THEN 3
    ELSE 4
END
WHERE quarter IS NULL;

-- Log migration results
DO $$
DECLARE
    kras_updated INTEGER;
    goals_updated INTEGER;
BEGIN
    SELECT COUNT(*) INTO kras_updated FROM kras WHERE quarter IS NOT NULL;
    SELECT COUNT(*) INTO goals_updated FROM goals WHERE quarter IS NOT NULL;
    RAISE NOTICE 'Migration complete: % KRAs and % goals now have quarter assigned', kras_updated, goals_updated;
END $$;

COMMIT;

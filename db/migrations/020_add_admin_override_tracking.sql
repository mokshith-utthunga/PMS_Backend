-- Migration: Add Admin/HR Override Tracking
-- Adds fields to track when Admin/HR overrides employee goals, self-evaluations, or manager evaluations

-- Add admin override columns to goals table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'goals' AND column_name = 'admin_override'
  ) THEN
    ALTER TABLE goals 
    ADD COLUMN admin_override BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN admin_override_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    ADD COLUMN admin_override_at TIMESTAMPTZ;
    
    CREATE INDEX IF NOT EXISTS idx_goals_admin_override ON goals(admin_override) WHERE admin_override = true;
    CREATE INDEX IF NOT EXISTS idx_goals_admin_override_by ON goals(admin_override_by) WHERE admin_override_by IS NOT NULL;
  END IF;
END $$;

-- Add admin override columns to quarterly_self_reviews table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'quarterly_self_reviews' AND column_name = 'admin_override'
  ) THEN
    ALTER TABLE quarterly_self_reviews 
    ADD COLUMN admin_override BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN admin_override_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    ADD COLUMN admin_override_at TIMESTAMPTZ;
    
    CREATE INDEX IF NOT EXISTS idx_quarterly_self_reviews_admin_override ON quarterly_self_reviews(admin_override) WHERE admin_override = true;
    CREATE INDEX IF NOT EXISTS idx_quarterly_self_reviews_admin_override_by ON quarterly_self_reviews(admin_override_by) WHERE admin_override_by IS NOT NULL;
  END IF;
END $$;

-- Add admin override columns to quarterly_manager_reviews table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'quarterly_manager_reviews' AND column_name = 'admin_override'
  ) THEN
    ALTER TABLE quarterly_manager_reviews 
    ADD COLUMN admin_override BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN admin_override_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    ADD COLUMN admin_override_at TIMESTAMPTZ;
    
    CREATE INDEX IF NOT EXISTS idx_quarterly_manager_reviews_admin_override ON quarterly_manager_reviews(admin_override) WHERE admin_override = true;
    CREATE INDEX IF NOT EXISTS idx_quarterly_manager_reviews_admin_override_by ON quarterly_manager_reviews(admin_override_by) WHERE admin_override_by IS NOT NULL;
  END IF;
END $$;

-- Create a simple view/helper table to track which quarters have admin overrides for quick lookup
-- We'll use a materialized view or just query the tables directly, but add a composite index for performance
CREATE INDEX IF NOT EXISTS idx_goals_employee_cycle_quarter_admin 
  ON goals(employee_id, cycle_id, quarter, admin_override) 
  WHERE admin_override = true;

CREATE INDEX IF NOT EXISTS idx_quarterly_self_reviews_employee_cycle_quarter_admin 
  ON quarterly_self_reviews(employee_id, cycle_id, quarter, admin_override) 
  WHERE admin_override = true;

CREATE INDEX IF NOT EXISTS idx_quarterly_manager_reviews_employee_cycle_quarter_admin 
  ON quarterly_manager_reviews(employee_id, cycle_id, quarter, admin_override) 
  WHERE admin_override = true;

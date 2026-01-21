-- Migration: Add HR Review Workflow Support
-- Adds fields for HR approval and employee rating rejection workflow

-- Add hr_approved_at and hr_approved_by to quarterly_manager_reviews
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'quarterly_manager_reviews' AND column_name = 'hr_approved_at'
  ) THEN
    ALTER TABLE quarterly_manager_reviews 
    ADD COLUMN hr_approved_at TIMESTAMPTZ,
    ADD COLUMN hr_approved_by UUID,
    ADD COLUMN released_at TIMESTAMPTZ;
    
    -- Add foreign key constraint if auth schema exists
    BEGIN
      ALTER TABLE quarterly_manager_reviews 
      ADD CONSTRAINT quarterly_manager_reviews_hr_approved_by_fkey 
      FOREIGN KEY (hr_approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;
    EXCEPTION WHEN OTHERS THEN
      -- If auth schema doesn't exist, just leave hr_approved_by as UUID without FK
      NULL;
    END;
  END IF;
END $$;

-- Create rating_rejections table for employee rejections
CREATE TABLE IF NOT EXISTS rating_rejections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    cycle_id UUID NOT NULL REFERENCES performance_cycles(id) ON DELETE CASCADE,
    quarter INTEGER NOT NULL,
    manager_review_id UUID NOT NULL REFERENCES quarterly_manager_reviews(id) ON DELETE CASCADE,
    rejection_reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
    resolved_at TIMESTAMPTZ,
    resolved_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(employee_id, cycle_id, quarter)
);

-- Add foreign key constraint for resolved_by if auth schema exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'auth') THEN
    BEGIN
      ALTER TABLE rating_rejections 
      ADD CONSTRAINT rating_rejections_resolved_by_fkey 
      FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN
      -- Constraint already exists, ignore
      NULL;
    END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rating_rejections_employee ON rating_rejections(employee_id);
CREATE INDEX IF NOT EXISTS idx_rating_rejections_cycle_quarter ON rating_rejections(cycle_id, quarter);
CREATE INDEX IF NOT EXISTS idx_rating_rejections_status ON rating_rejections(status);

-- Add employee_acknowledged_at to quarterly_manager_reviews for tracking employee acceptance
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'quarterly_manager_reviews' AND column_name = 'employee_acknowledged_at'
  ) THEN
    ALTER TABLE quarterly_manager_reviews 
    ADD COLUMN employee_acknowledged_at TIMESTAMPTZ,
    ADD COLUMN employee_rejected_at TIMESTAMPTZ;
  END IF;
END $$;

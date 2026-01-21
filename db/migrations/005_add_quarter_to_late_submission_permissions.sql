-- Migration: Add quarter column to late_submission_permissions
-- This allows quarter-specific late submission permissions

-- Step 1: Add quarter column
ALTER TABLE late_submission_permissions 
ADD COLUMN IF NOT EXISTS quarter INTEGER CHECK (quarter BETWEEN 1 AND 4);

-- Step 2: Drop old unique constraint (cycle_id, employee_id)
ALTER TABLE late_submission_permissions 
DROP CONSTRAINT IF EXISTS late_submission_permissions_cycle_id_employee_id_key;

-- Step 3: Add new unique constraint including quarter
-- Allow NULL quarter for backward compatibility (means all quarters)
CREATE UNIQUE INDEX IF NOT EXISTS late_submission_permissions_cycle_employee_quarter_idx 
ON late_submission_permissions (cycle_id, employee_id, COALESCE(quarter, 0));

-- Step 4: Add index for faster lookups
CREATE INDEX IF NOT EXISTS late_submission_permissions_quarter_idx 
ON late_submission_permissions (quarter);

-- Comment for documentation
COMMENT ON COLUMN late_submission_permissions.quarter IS 'Quarter number (1-4). NULL means permission applies to all quarters.';

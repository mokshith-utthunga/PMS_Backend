-- Migration: Add type and role columns to late_submission_permissions
-- This allows type-specific and role-specific late submission permissions
-- type: 'goals', 'evaluations', 'manager-goals-approval', 'manager-evaluations'
-- role: 'employee', 'manager'

-- Step 1: Add type column
ALTER TABLE late_submission_permissions 
ADD COLUMN IF NOT EXISTS type VARCHAR(50) CHECK (type IN ('goals', 'evaluations', 'manager-goals-approval', 'manager-evaluations'));

-- Step 2: Add role column
ALTER TABLE late_submission_permissions 
ADD COLUMN IF NOT EXISTS role VARCHAR(20) CHECK (role IN ('employee', 'manager'));

-- Step 3: Drop old unique constraint
DROP INDEX IF EXISTS late_submission_permissions_cycle_employee_quarter_idx;

-- Step 4: Add new unique constraint including type and role
-- This ensures one permission per employee per cycle per quarter per type per role
CREATE UNIQUE INDEX IF NOT EXISTS late_submission_permissions_cycle_employee_quarter_type_role_idx 
ON late_submission_permissions (
  cycle_id, 
  employee_id, 
  COALESCE(quarter, 0),
  COALESCE(type, 'goals'),
  COALESCE(role, 'employee')
);

-- Step 5: Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS late_submission_permissions_type_idx 
ON late_submission_permissions (type);

CREATE INDEX IF NOT EXISTS late_submission_permissions_role_idx 
ON late_submission_permissions (role);

-- Step 6: Add comments for documentation
COMMENT ON COLUMN late_submission_permissions.type IS 'Type of late submission: goals, evaluations, manager-goals-approval, manager-evaluations';
COMMENT ON COLUMN late_submission_permissions.role IS 'Role for the permission: employee or manager';

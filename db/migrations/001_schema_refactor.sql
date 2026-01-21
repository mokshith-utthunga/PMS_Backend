
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS role app_role;

-- Migrate roles from user_roles table if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'user_roles'
  ) THEN
    UPDATE profiles p
    SET role = COALESCE(
      (SELECT ur.role 
       FROM user_roles ur 
       WHERE ur.user_id = p.id 
       ORDER BY 
         CASE ur.role
           WHEN 'system_admin' THEN 1
           WHEN 'hrbp' THEN 2
           WHEN 'hr_admin' THEN 3
           WHEN 'dept_head' THEN 4
           WHEN 'manager' THEN 5
           WHEN 'employee' THEN 6
         END
       LIMIT 1),
      'employee'::app_role
    )
    WHERE role IS NULL;
  ELSE
    -- If user_roles doesn't exist, set default role for profiles without roles
    UPDATE profiles
    SET role = 'employee'::app_role
    WHERE role IS NULL;
  END IF;
END $$;

-- Step 3: Ensure all profiles have a role, then set default and make NOT NULL
DO $$
BEGIN
  -- Set default role for any profiles that still don't have one
  UPDATE profiles
  SET role = 'employee'::app_role
  WHERE role IS NULL;
  
  -- Set default value and make NOT NULL
  ALTER TABLE profiles 
  ALTER COLUMN role SET DEFAULT 'employee'::app_role;
  
  ALTER TABLE profiles 
  ALTER COLUMN role SET NOT NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- Rename emp_id to emp_code if emp_id exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employees' AND column_name = 'emp_id'
  ) THEN
    ALTER TABLE employees RENAME COLUMN emp_id TO emp_code;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'employees_emp_code_key' 
    AND conrelid = 'employees'::regclass
  ) THEN
    ALTER TABLE employees ADD CONSTRAINT employees_emp_code_key UNIQUE (emp_code);
  END IF;
END $$;

-- Step 3: Rename manager_id to manager_code if manager_id exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employees' AND column_name = 'manager_id'
  ) THEN
    ALTER TABLE employees RENAME COLUMN manager_id TO manager_code;
  END IF;
END $$;

-- Step 4: Convert manager_code from UUID to VARCHAR(255) referencing emp_code
DO $$
DECLARE
  r RECORD;
BEGIN
  -- Drop ALL foreign key constraints on manager_code (regardless of name or referenced column)
  -- This handles both old manager_id_fkey and any existing manager_code_fkey
  FOR r IN (
    SELECT conname 
    FROM pg_constraint 
    WHERE conrelid = 'employees'::regclass
      AND contype = 'f'
      AND conkey::text = (
        SELECT array_agg(attnum ORDER BY attnum)::text
        FROM pg_attribute
        WHERE attrelid = 'employees'::regclass
          AND attname = 'manager_code'
      )
  ) LOOP
    EXECUTE 'ALTER TABLE employees DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
  END LOOP;
  
  -- Also drop by specific names for safety
  ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_manager_id_fkey;
  ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_manager_code_fkey;
  
  -- Step 1: Change column type from UUID to TEXT first (simple cast, no subqueries)
  -- Check if column is still UUID type
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employees' 
      AND column_name = 'manager_code' 
      AND data_type = 'uuid'
  ) THEN
    -- Convert UUID to TEXT first
    ALTER TABLE employees 
    ALTER COLUMN manager_code TYPE TEXT USING manager_code::TEXT;
  END IF;
  
  -- Step 2: Convert UUID text values to emp_code values
  UPDATE employees e1
  SET manager_code = (
    SELECT e2.emp_code 
    FROM employees e2 
    WHERE e2.id::text = e1.manager_code
    LIMIT 1
  )
  WHERE e1.manager_code IS NOT NULL 
    AND e1.manager_code ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' -- UUID pattern
    AND EXISTS (
      SELECT 1 FROM employees e2 
      WHERE e2.id::text = e1.manager_code
    );
  
  -- Step 3: Set NULL for any manager_code values that couldn't be converted
  UPDATE employees
  SET manager_code = NULL
  WHERE manager_code IS NOT NULL 
    AND manager_code ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' -- Still a UUID pattern
    AND NOT EXISTS (
      SELECT 1 FROM employees e2 
      WHERE e2.emp_code = employees.manager_code
    );
  
  -- Step 4: Change column type from TEXT to VARCHAR(255)
  ALTER TABLE employees 
  ALTER COLUMN manager_code TYPE VARCHAR(255);
  
  -- Add new foreign key constraint referencing employees(emp_code)
  -- Drop first to ensure clean state
  ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_manager_code_fkey;
  
  ALTER TABLE employees 
  ADD CONSTRAINT employees_manager_code_fkey 
  FOREIGN KEY (manager_code) REFERENCES employees(emp_code) ON DELETE SET NULL;
END $$;

-- Step 5: Update index name for manager_code
DROP INDEX IF EXISTS idx_employees_manager_id;
CREATE INDEX IF NOT EXISTS idx_employees_manager_code ON employees(manager_code);

-- Step 6: Add sub_department column (nullable)
ALTER TABLE employees 
ADD COLUMN IF NOT EXISTS sub_department TEXT;


-- Rename user_id to profile_id in employees table
DO $$
BEGIN
  -- Check if user_id column exists and rename it to profile_id
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employees' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE employees RENAME COLUMN user_id TO profile_id;
  END IF;
END $$;

-- Update foreign key constraint
DO $$
BEGIN
  -- Drop old constraint if it exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'employees_user_id_fkey' 
    AND conrelid = 'employees'::regclass
  ) THEN
    ALTER TABLE employees DROP CONSTRAINT employees_user_id_fkey;
  END IF;
  
  -- Add new constraint with new name
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'employees_profile_id_fkey' 
    AND conrelid = 'employees'::regclass
  ) THEN
    ALTER TABLE employees 
    ADD CONSTRAINT employees_profile_id_fkey 
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Update index name
DROP INDEX IF EXISTS idx_employees_user_id;
CREATE INDEX IF NOT EXISTS idx_employees_profile_id ON employees(profile_id);

-- Add full_name column to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS full_name TEXT;

-- Merge first_name and last_name into full_name in employees table
DO $$
BEGIN
  -- Add full_name column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employees' AND column_name = 'full_name'
  ) THEN
    ALTER TABLE employees ADD COLUMN full_name TEXT;
  END IF;
  
  -- Migrate existing data: combine first_name and last_name into full_name
  -- Only update if first_name or last_name columns exist
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employees' AND column_name = 'first_name'
  ) OR EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employees' AND column_name = 'last_name'
  ) THEN
    UPDATE employees 
    SET full_name = TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
    WHERE (full_name IS NULL OR full_name = '')
      AND (first_name IS NOT NULL OR last_name IS NOT NULL);
    
    -- Set default for any remaining NULL values
    UPDATE employees
    SET full_name = 'Unknown'
    WHERE full_name IS NULL OR full_name = '';
  END IF;
  
  -- Make full_name NOT NULL after migration (only if column exists)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employees' AND column_name = 'full_name'
  ) THEN
    -- First ensure no NULL values
    UPDATE employees
    SET full_name = 'Unknown'
    WHERE full_name IS NULL;
    
    -- Then set NOT NULL
    ALTER TABLE employees 
    ALTER COLUMN full_name SET NOT NULL;
  END IF;
  
  -- Drop first_name and last_name columns
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employees' AND column_name = 'first_name'
  ) THEN
    ALTER TABLE employees DROP COLUMN first_name;
  END IF;
  
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employees' AND column_name = 'last_name'
  ) THEN
    ALTER TABLE employees DROP COLUMN last_name;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_user_roles_user_id;

-- Drop user_roles table
DROP TABLE IF EXISTS user_roles CASCADE;


-- Migration: Fix manager_code foreign key to reference emp_code instead of id
-- This migration fixes the foreign key constraint that may still reference employees(id)

BEGIN;

-- Step 1: Drop the existing foreign key constraint if it references employees(id)
DO $$
DECLARE
  constraint_name TEXT;
  constraint_def TEXT;
BEGIN
  -- Find and drop any foreign key constraint on manager_code
  FOR constraint_name IN (
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
    -- Get constraint definition to check what it references
    SELECT pg_get_constraintdef(oid) INTO constraint_def
    FROM pg_constraint
    WHERE conname = constraint_name;
    
    -- Drop if it references employees(id) instead of employees(emp_code)
    IF constraint_def LIKE '%employees(id)%' OR constraint_def LIKE '%employees.id%' THEN
      EXECUTE 'ALTER TABLE employees DROP CONSTRAINT IF EXISTS ' || quote_ident(constraint_name);
      RAISE NOTICE 'Dropped constraint % that referenced employees(id)', constraint_name;
    END IF;
  END LOOP;
  
  -- Also drop by specific name for safety
  ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_manager_code_fkey;
END $$;

-- Step 2: Convert existing UUID manager_code values to emp_code values (if not already converted)
DO $$
BEGIN
  -- Only convert if manager_code still contains UUIDs
  UPDATE employees e1
  SET manager_code = (
    SELECT e2.emp_code 
    FROM employees e2 
    WHERE e2.id::text = e1.manager_code::text
  )
  WHERE e1.manager_code IS NOT NULL 
    AND e1.manager_code ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' -- UUID pattern
    AND EXISTS (
      SELECT 1 FROM employees e2 
      WHERE e2.id::text = e1.manager_code::text
    );
  
  -- Set NULL for any UUID values that couldn't be converted
  UPDATE employees
  SET manager_code = NULL
  WHERE manager_code IS NOT NULL 
    AND manager_code ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' -- UUID pattern
    AND NOT EXISTS (
      SELECT 1 FROM employees e2 
      WHERE e2.emp_code = employees.manager_code
    );
END $$;

-- Step 3: Change column type to VARCHAR(255) if it's still UUID
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'employees' 
      AND column_name = 'manager_code' 
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE employees 
    ALTER COLUMN manager_code TYPE VARCHAR(255) USING manager_code::VARCHAR(255);
    RAISE NOTICE 'Changed manager_code column type from UUID to VARCHAR(255)';
  END IF;
END $$;

-- Step 4: Add the correct foreign key constraint referencing employees(emp_code)
DO $$
BEGIN
  -- Drop if exists (should already be dropped, but just in case)
  ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_manager_code_fkey;
  
  -- Add new constraint referencing employees(emp_code)
  ALTER TABLE employees 
  ADD CONSTRAINT employees_manager_code_fkey 
  FOREIGN KEY (manager_code) REFERENCES employees(emp_code) ON DELETE SET NULL;
  
  RAISE NOTICE 'Created foreign key constraint employees_manager_code_fkey referencing employees(emp_code)';
END $$;

COMMIT;

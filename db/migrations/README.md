# Database Schema Migration Guide

## Overview

This migration refactors the database schema to:
1. Merge `user_roles` table into `profiles` table (roles now stored in `profiles.role`)
2. Rename `employees.emp_id` → `employees.emp_code`
3. Rename `employees.manager_id` → `employees.manager_code`
4. Rename `employees.user_id` → `employees.profile_id`
5. Add `employees.sub_department` column
6. Ensure `employees.profile_id` properly references `profiles.id`

## Migration File

**File:** `001_schema_refactor.sql`

## Pre-Migration Checklist

- [ ] Backup your database
- [ ] Ensure no active transactions are running
- [ ] Verify all applications are stopped or in maintenance mode
- [ ] Test the migration on a staging environment first

## Running the Migration

### Option 1: Using psql

```bash
psql -U postgres -d PMS -f server/db/migrations/001_schema_refactor.sql
```

### Option 2: Using pgAdmin or other GUI tools

1. Open the migration file: `server/db/migrations/001_schema_refactor.sql`
2. Execute it against your database

### Option 3: Using Node.js script (if available)

```bash
node scripts/run-migration.js 001_schema_refactor.sql
```

## Post-Migration Verification

After running the migration, verify the changes:

```sql
-- Verify profiles have roles
SELECT COUNT(*) as total_profiles, COUNT(role) as profiles_with_role 
FROM profiles;

-- Verify employees table structure
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'employees' 
AND column_name IN ('emp_code', 'manager_code', 'sub_department', 'profile_id');

-- Verify foreign keys
SELECT conname, conrelid::regclass, confrelid::regclass 
FROM pg_constraint 
WHERE contype = 'f' 
AND (conrelid = 'employees'::regclass OR confrelid = 'profiles'::regclass);

-- Verify user_roles table is dropped
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_name = 'user_roles'
) as user_roles_exists;
-- Should return false
```

## Rollback (if needed)

If you need to rollback, you would need to:

1. Recreate `user_roles` table
2. Migrate roles back from `profiles.role` to `user_roles`
3. Rename columns back (`emp_code` → `emp_id`, `manager_code` → `manager_id`, `profile_id` → `user_id`)
4. Drop `sub_department` column
5. Update all code references

**Note:** A rollback script is not provided. Ensure you have a backup before running the migration.

## Code Changes Summary

### Backend Changes

1. **Routes Updated:**
   - `routes/auth.js` - Updated role assignment and retrieval
   - `routes/api.js` - Updated RPC functions and valid tables list
   - `routes/data.js` - Updated employee endpoints, user-roles endpoints (backward compatible)
   - `routes/employees.js` - Updated to use new column names
   - `routes/cycles.js` - Updated manager queries
   - `routes/goals.js` - Updated manager queries
   - `routes/stats.js` - Updated manager queries
   - `routes/sso.js` - Updated role assignment and employee creation

2. **Schema Files Updated:**
   - `db/schema.sql` - Reflects new structure
   - `db/seed.sql` - Updated to use new column names and role storage

### Frontend Changes

1. **TypeScript Types Updated:**
   - `client/src/types/index.ts` - Updated `Employee` and `Profile` interfaces
   - Added backward compatibility fields (`emp_id`, `manager_id` as optional)

## Backward Compatibility

The migration maintains backward compatibility:

1. **API Endpoints:** Support both old (`emp_id`, `manager_id`, `user_id`) and new (`emp_code`, `manager_code`, `profile_id`) parameter names
2. **TypeScript Types:** Include optional fields for old column names
3. **User Roles API:** `/api/data/user-roles` endpoints still work but now read/write from `profiles.role`

## Important Notes

1. **Role Migration:** If a user had multiple roles in `user_roles`, the migration selects the highest priority role:
   - Priority: system_admin > hrbp > hr_admin > dept_head > manager > employee

2. **Foreign Keys:** The `manager_code` column still references `employees.id` (UUID), not `emp_code`. This maintains referential integrity.

3. **Indexes:** Old indexes are dropped and new ones created automatically by the migration.

4. **Default Values:** New profiles default to `'employee'` role if not specified.

## Testing Recommendations

After migration, test:

1. User authentication and role retrieval
2. Employee CRUD operations
3. Manager-employee relationships
4. Goal approvals (manager workflows)
5. Evaluation workflows
6. Calibration features
7. SSO authentication (if used)

## Support

If you encounter issues during migration:

1. Check PostgreSQL logs for detailed error messages
2. Verify all foreign key constraints are satisfied
3. Ensure no orphaned records exist
4. Check that all profiles have roles assigned

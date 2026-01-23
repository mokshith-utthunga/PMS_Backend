# Migration Execution Order

## Critical: Run migrations in this exact order

### Phase 1: Create New Tables ✅
1. **007_add_quarterly_cycles_tables.sql**
   - Creates `quarterly_cycles` table
   - Creates `goals_quarterly_cycles` table
   - Backfills data from legacy columns
   - **Status**: Must complete successfully

1b. **013_link_goals_to_quarterly_cycles.sql** (Required)
   - Adds `quarterly_cycle_id` foreign key to `goals_quarterly_cycles`
   - Removes `quarterly_start_date` and `quarterly_end_date` columns from `goals_quarterly_cycles`
   - Quarter dates are now fetched from `quarterly_cycles` via the FK join
   - **Status**: Run after 007 and 008

### Phase 2: Fix Data Issues (if needed)
2. **008_fix_invalid_dates.sql** (Optional - only if 008 fails)
   - Fixes invalid date ordering
   - Run ONLY if migration 008 fails with constraint violations
   - **Status**: Run only if needed

### Phase 3: Optimize Tables ✅
3. **008_optimize_cycles_tables.sql**
   - Adds indexes for performance
   - Adds constraints (skips if data invalid)
   - **Status**: Can run after 007

### Phase 4: Deprecate Legacy Columns
4. **009_deprecate_legacy_quarterly_columns.sql**
   - Marks q1-q4 columns as deprecated
   - Creates tracking views
   - **Status**: Safe to run anytime after 007

### Phase 5: Remove Annual Columns ⚠️
5. **011_remove_annual_goal_eval_columns.sql** ⚠️
   - Removes annual goal/evaluation columns
   - **WARNING**: Only run if you don't use annual cycles
   - **Status**: Run only after confirming no annual cycles

### Phase 6: Remove Legacy Quarterly Columns (Future)
6. **010_remove_legacy_quarterly_columns.sql** ⚠️
   - Removes q1-q4 columns
   - **WARNING**: Only run after ALL code is migrated
   - **Status**: Do NOT run until code migration complete

## Recommended Execution Sequence

```bash
# Step 1: Create new tables
psql -U postgres -d PMS -f 007_add_quarterly_cycles_tables.sql

# Step 2: Optimize (if 008 fails, run 008_fix_invalid_dates.sql first)
psql -U postgres -d PMS -f 008_fix_invalid_dates.sql  # Only if needed
psql -U postgres -d PMS -f 008_optimize_cycles_tables.sql

# Step 3: Link goals to quarterly cycles (adds FK, removes redundant columns)
psql -U postgres -d PMS -f 013_link_goals_to_quarterly_cycles.sql

# Step 4: Deprecate legacy columns
psql -U postgres -d PMS -f 009_deprecate_legacy_quarterly_columns.sql

# Step 5: Remove annual columns (ONLY if you don't use annual cycles)
# ⚠️ Review warnings before proceeding
psql -U postgres -d PMS -f 011_remove_annual_goal_eval_columns.sql

# Step 6: Update code to use new tables
# ... (code changes) ...

# Step 7: Remove legacy quarterly columns (ONLY after code migration)
# ⚠️ DO NOT RUN until all code is updated
# psql -U postgres -d PMS -f 010_remove_legacy_quarterly_columns.sql
```

## Migration Dependencies

```
007 (Create Tables)
  ↓
008_fix (Fix Data) [Optional]
  ↓
008 (Optimize)
  ↓
013 (Link Goals to Quarterly Cycles - adds FK, removes redundant date columns)
  ↓
009 (Deprecate Quarterly)
  ↓
011 (Remove Annual) [Optional - only if no annual cycles]
  ↓
[Code Migration]
  ↓
010 (Remove Quarterly) [Future - after code migration]
```

## Important Notes

1. **Migration 007** must complete successfully before any other migration
2. **Migration 008_fix** is optional - only run if 008 fails
3. **Migration 011** removes annual columns - ensure you don't need them
4. **Migration 010** should be run LAST, only after all code is updated
5. Always backup database before running migrations
6. Test on staging environment first

## Rollback Strategy

If you need to rollback:

1. **After 007**: Data is in both old and new tables - safe
2. **After 008**: Indexes can be dropped, constraints can be dropped
3. **After 009**: Only comments added - safe
4. **After 011**: ⚠️ Columns removed - need backup to restore
5. **After 010**: ⚠️ Columns removed - need backup to restore

## Verification After Each Migration

```sql
-- After 007: Verify data migrated
SELECT COUNT(*) FROM quarterly_cycles;
SELECT COUNT(*) FROM goals_quarterly_cycles;

-- After 008: Verify indexes created
SELECT indexname FROM pg_indexes WHERE tablename = 'performance_cycles';

-- After 013: Verify FK and column changes
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'goals_quarterly_cycles' 
AND column_name IN ('quarterly_cycle_id', 'quarterly_start_date', 'quarterly_end_date');
-- Should show quarterly_cycle_id but NOT quarterly_start_date or quarterly_end_date

-- Verify FK works
SELECT gqc.id, gqc.quarter, qc.quarter_start_date, qc.quarter_end_date 
FROM goals_quarterly_cycles gqc
LEFT JOIN quarterly_cycles qc ON gqc.quarterly_cycle_id = qc.id
LIMIT 5;

-- After 009: Check migration status
SELECT * FROM performance_cycles_legacy_columns_status;

-- After 011: Verify columns removed
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'performance_cycles' 
AND column_name IN ('goal_submission_start', 'self_evaluation_start');
-- Should return 0 rows
```

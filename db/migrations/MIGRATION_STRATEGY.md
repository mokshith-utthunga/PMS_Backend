# Migration Strategy: Legacy Quarterly Columns Removal

## Overview

The `performance_cycles` table currently contains redundant quarterly columns (`q1_*`, `q2_*`, `q3_*`, `q4_*`) that have been replaced by normalized tables:
- `quarterly_cycles` - for evaluation cycles
- `goals_quarterly_cycles` - for goal submission cycles

## Why Keep Legacy Columns Temporarily?

1. **Backward Compatibility**: Existing code may still reference these columns
2. **Gradual Migration**: Allows incremental code updates without breaking changes
3. **Data Safety**: Ensures all data is migrated before removal
4. **Rollback Capability**: Can revert if issues arise

## Migration Phases

### Phase 1: ✅ Create New Tables (Migration 007)
- Create `quarterly_cycles` table
- Create `goals_quarterly_cycles` table
- Backfill data from legacy columns
- **Status**: Complete

### Phase 2: ✅ Deprecate Legacy Columns (Migration 009)
- Mark columns as deprecated with comments
- Create migration tracking view
- Create sync function for backward compatibility
- **Status**: Ready to run

### Phase 3: 🔄 Update Application Code
- Update backend APIs to use new tables
- Update frontend to use new tables
- Remove references to legacy columns
- **Status**: In Progress

### Phase 4: ⏳ Remove Legacy Columns (Migration 010)
- Verify all code migrated
- Drop legacy columns
- **Status**: Not Started (DO NOT RUN until Phase 3 complete)

## Current Column Usage

### Legacy Columns (To Be Removed)
```sql
-- Evaluation cycles (replaced by quarterly_cycles)
q1_self_review_start, q1_self_review_end
q1_manager_review_start, q1_manager_review_end
q2_self_review_start, q2_self_review_end
q2_manager_review_start, q2_manager_review_end
q3_self_review_start, q3_self_review_end
q3_manager_review_start, q3_manager_review_end
q4_self_review_start, q4_self_review_end
q4_manager_review_start, q4_manager_review_end
```

### Annual Goal Columns (Keep - Used for Annual Goals)
```sql
-- These are for ANNUAL goals, not quarterly
goal_submission_start      -- Annual goal submission period
goal_submission_end        -- Annual goal submission period
goal_approval_end          -- Annual goal approval period
```

**Note**: `goal_submission_start/end/approval_end` are **NOT** deprecated - they're for annual goals. Quarterly goals use `goals_quarterly_cycles` table.

## Migration Checklist

### Before Running Migration 009 (Deprecate):
- [x] Migration 007 completed successfully
- [x] All data backfilled to new tables
- [ ] Verify no critical code paths depend on legacy columns

### Before Running Migration 010 (Remove):
- [ ] All backend APIs updated to use new tables
- [ ] All frontend code updated to use new tables
- [ ] All reports/queries updated
- [ ] Tested in staging environment
- [ ] Verified no errors in application logs
- [ ] Database backup created
- [ ] Rollback plan prepared

## Code Migration Guide

### Backend: Reading Quarterly Dates

**Old Way (Deprecated):**
```javascript
const cycle = await getCycle(cycleId);
const q1Start = cycle.q1_self_review_start;
```

**New Way:**
```javascript
const qc = await query(
  'SELECT * FROM quarterly_cycles WHERE performance_cycle_id = $1 AND quarter = $2',
  [cycleId, 1]
);
const q1Start = qc.self_review_start_date;
```

### Backend: Reading Goal Deadlines

**Old Way (Deprecated - for quarterly goals):**
```javascript
const cycle = await getCycle(cycleId);
const goalEnd = cycle.goal_submission_end; // Only for annual goals!
```

**New Way (For Quarterly Goals):**
```javascript
const gqc = await query(
  'SELECT * FROM goals_quarterly_cycles WHERE performance_cycle_id = $1 AND quarter = $2',
  [cycleId, 1]
);
const goalEnd = gqc.goal_submission_end_date;
```

**Note**: `goal_submission_end` in `performance_cycles` is still valid for **annual** goals.

## Verification Queries

### Check Migration Status
```sql
SELECT * FROM performance_cycles_legacy_columns_status;
```

### Find Cycles Using Legacy Columns
```sql
SELECT id, name, year
FROM performance_cycles
WHERE q1_self_review_start IS NOT NULL
   OR q2_self_review_start IS NOT NULL
   OR q3_self_review_start IS NOT NULL
   OR q4_self_review_start IS NOT NULL;
```

### Verify New Tables Have Data
```sql
SELECT 
    pc.id,
    pc.name,
    COUNT(DISTINCT qc.quarter) as eval_quarters,
    COUNT(DISTINCT gqc.quarter) as goal_quarters
FROM performance_cycles pc
LEFT JOIN quarterly_cycles qc ON qc.performance_cycle_id = pc.id
LEFT JOIN goals_quarterly_cycles gqc ON gqc.performance_cycle_id = pc.id
GROUP BY pc.id, pc.name;
```

## Rollback Plan

If issues arise after removing columns:

1. **Restore from backup** (if migration 010 was run)
2. **Re-add columns** (if needed):
```sql
ALTER TABLE performance_cycles
    ADD COLUMN q1_self_review_start DATE,
    ADD COLUMN q1_self_review_end DATE,
    -- ... (all columns)
```

3. **Re-run migration 007** to backfill data
4. **Fix code issues** before attempting removal again

## Timeline Recommendation

- **Week 1-2**: Run migration 009 (deprecate columns)
- **Week 3-6**: Update all code to use new tables
- **Week 7**: Testing and verification
- **Week 8**: Run migration 010 (remove columns) - **ONLY after all code is updated**

## Support

If you encounter issues:
1. Check migration logs
2. Verify data in new tables
3. Check application logs for errors
4. Use verification queries above
5. Review this document for migration status

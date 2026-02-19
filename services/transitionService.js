import { query } from '../config/database.js';

/**
 * Transition Service
 * Handles mid-quarter employee transitions (promotions, project changes, role changes)
 * Follows DRY and KISS principles
 */

/**
 * Check if employee with transition can perform actions (within quarter dates only)
 * Returns true if employee has transition AND current date is within quarter date range
 */
export async function canPerformTransitionActions(employeeId, cycleId, quarter) {
  // Check if employee has active transition
  const hasTransition = await hasActiveTransition(employeeId, cycleId, quarter);
  if (!hasTransition) {
    return false;
  }
  
  // Get quarter date range
  const quarterRange = await getQuarterDateRange(cycleId, quarter);
  if (!quarterRange || !quarterRange.startDate || !quarterRange.endDate) {
    return false;
  }
  
  // Check if current date is within quarter dates
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const quarterStart = new Date(quarterRange.startDate);
  quarterStart.setHours(0, 0, 0, 0);
  const quarterEnd = new Date(quarterRange.endDate);
  quarterEnd.setHours(23, 59, 59, 999);
  
  return now >= quarterStart && now <= quarterEnd;
}

/**
 * Determine manager role for a transition
 * Uses manager_history table to get accurate manager information
 * Returns: 'old_manager', 'new_manager', 'same_manager', or null
 */
export async function getManagerRoleForTransition(managerId, employeeId, cycleId, quarter) {
  try {
    if (!managerId || !employeeId || !cycleId || !quarter) {
      return null;
    }

    // Get transition for this employee/cycle/quarter
    const transitionResult = await query(
      `SELECT id, transition_date, old_manager_id, new_manager_id
       FROM employee_quarter_transitions
       WHERE employee_id = $1
         AND cycle_id = $2
         AND quarter = $3`,
      [employeeId, cycleId, quarter]
    );

    if (transitionResult.rows.length === 0) {
      return null; // No transition
    }

    const transition = transitionResult.rows[0];
    
    // Get manager history entry for this transition
    // Use direct transition_id link (more reliable than date matching)
    const managerHistoryResult = await query(
      `SELECT old_manager_id, new_manager_id
       FROM manager_history
       WHERE transition_id = $1
       LIMIT 1`,
      [transition.id]
    );

    let oldManagerId = transition.old_manager_id;
    let newManagerId = transition.new_manager_id;

    // If manager_history has the record, use it (more accurate - not affected by employees.manager_code updates)
    if (managerHistoryResult.rows.length > 0) {
      const history = managerHistoryResult.rows[0];
      oldManagerId = history.old_manager_id;
      newManagerId = history.new_manager_id;
    }

    // If new_manager_id is null or empty, it is considered as the same manager
    const isNewManagerIdEmpty = !newManagerId || newManagerId === '';
    
    const isOldManager = oldManagerId && oldManagerId === managerId;
    const isNewManager = newManagerId && newManagerId === managerId;
    
    // If new_manager_id is null/empty, treat as same manager
    if (isNewManagerIdEmpty) {
      if (isOldManager) {
        return 'same_manager'; // Manager didn't change, so it's the same manager
      } else {
        return null; // Not involved in this transition
      }
    }
    
    const managersAreDifferent = newManagerId && 
                                  newManagerId !== oldManagerId;

    if (managersAreDifferent) {
      // Different managers
      if (isOldManager) {
        return 'old_manager';
      } else if (isNewManager) {
        return 'new_manager';
      } else {
        return null; // Not involved in this transition
      }
    } else {
      // Same manager (new_manager_id equals old_manager_id)
      if (isOldManager || isNewManager) {
        return 'same_manager';
      } else {
        return null; // Not involved in this transition
      }
    }
  } catch (error) {
    console.error('Error determining manager role for transition:', error);
    return null;
  }
}

/**
 * Get quarter date range from cycle
 */
async function getQuarterDateRange(cycleId, quarter) {
  // Get quarter dates from quarterly_cycles table
  // Note: quarterly_start_date/quarterly_end_date were removed from goals_quarterly_cycles
  // Dates are now stored in quarterly_cycles as quarter_start_date/quarter_end_date
  let cycleResult = await query(
    `SELECT quarter_start_date, quarter_end_date 
     FROM quarterly_cycles 
     WHERE performance_cycle_id = $1 AND quarter = $2`,
    [cycleId, quarter]
  );
  
  // If no data in quarterly_cycles, calculate from performance_cycles year (fallback)
  if (cycleResult.rows.length === 0) {
    const yearResult = await query(
      `SELECT year FROM performance_cycles WHERE id = $1`,
      [cycleId]
    );
    
    if (yearResult.rows.length === 0) {
      throw new Error(`Cycle ${cycleId} not found`);
    }
    
    const year = yearResult.rows[0].year;
    // Calculate quarter dates based on year
    const quarterStartMonths = { 1: 0, 2: 3, 3: 6, 4: 9 }; // Jan, Apr, Jul, Oct
    const quarterEndMonths = { 1: 2, 2: 5, 3: 8, 4: 11 }; // Mar, Jun, Sep, Dec
    
    const startMonth = quarterStartMonths[quarter];
    const endMonth = quarterEndMonths[quarter];
    
    if (startMonth === undefined || endMonth === undefined) {
      throw new Error(`Invalid quarter: ${quarter}. Must be between 1 and 4`);
    }
    
    const startDate = new Date(year, startMonth, 1);
    const endDate = new Date(year, endMonth + 1, 0); // Last day of the month
    
    return { startDate, endDate };
  }
  
  if (!cycleResult.rows[0].quarter_start_date || !cycleResult.rows[0].quarter_end_date) {
    throw new Error(`Quarter ${quarter} dates not found for cycle ${cycleId}`);
  }
  
  return {
    startDate: new Date(cycleResult.rows[0].quarter_start_date),
    endDate: new Date(cycleResult.rows[0].quarter_end_date)
  };
}

/**
 * Calculate days between two dates
 */
function calculateDays(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end - start);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both dates
}

/**
 * Check if transition date is within quarter
 */
async function validateTransitionDate(cycleId, quarter, transitionDate) {
  const { startDate, endDate } = await getQuarterDateRange(cycleId, quarter);
  const transition = new Date(transitionDate);
  
  if (transition < startDate || transition > endDate) {
    throw new Error(`Transition date must be within quarter ${quarter} date range (${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]})`);
  }
  
  return { startDate, endDate };
}

/**
 * Get employee's current manager
 */
async function getEmployeeManager(employeeId) {
  const result = await query(
    `SELECT e.id, e.emp_code, e.manager_code, m.id as manager_id
     FROM employees e
     LEFT JOIN employees m ON m.emp_code = e.manager_code
     WHERE e.id = $1`,
    [employeeId]
  );
  
  if (result.rows.length === 0) {
    throw new Error(`Employee ${employeeId} not found`);
  }
  
  return {
    managerCode: result.rows[0].manager_code,
    managerId: result.rows[0].manager_id
  };
}

/**
 * Get employee details
 */
async function getEmployeeDetails(employeeId) {
  const result = await query(
    'SELECT id, emp_code, department, grade, manager_code FROM employees WHERE id = $1',
    [employeeId]
  );
  
  if (result.rows.length === 0) {
    throw new Error(`Employee ${employeeId} not found`);
  }
  
  return result.rows[0];
}

/**
 * Create transition record
 */
export async function createTransition(employeeId, cycleId, quarter, transitionData, createdBy) {
  const {
    transition_type,
    transition_date,
    new_manager_id,
    new_department,
    new_grade,
    new_project
  } = transitionData;
  
  // Normalize new_manager_id - convert empty string, "none", or undefined to null
  const normalizedNewManagerId = (!new_manager_id || new_manager_id === '' || new_manager_id === 'none') 
    ? null 
    : new_manager_id;
  
  // Get quarter date range (validation removed - transition date can be outside quarter range)
  const { startDate, endDate } = await getQuarterDateRange(cycleId, quarter);
  
  // Get current employee details
  const employee = await getEmployeeDetails(employeeId);
  const currentManager = await getEmployeeManager(employeeId);
  
  // If new_manager_id is null, set it to old_manager_id (current manager)
  // This ensures that when no new manager is specified, the old manager is retained
  let finalNewManagerId = normalizedNewManagerId;
  if (!finalNewManagerId && currentManager.managerId) {
    // If new_manager_id is null and old_manager_id exists, use old_manager_id
    finalNewManagerId = currentManager.managerId;
  } else if (finalNewManagerId && finalNewManagerId === currentManager.managerId) {
    // If new_manager_id is same as current manager, keep it as is (manager didn't change)
    finalNewManagerId = currentManager.managerId;
  }
  // If both are null, finalNewManagerId remains null (no manager assigned)
  
  // Get new manager details if provided and different from current
  let newManagerCode = null;
  if (finalNewManagerId) {
    const newManager = await getEmployeeDetails(finalNewManagerId);
    newManagerCode = newManager.emp_code;
  }
  
  // Calculate period dates
  const transitionDate = new Date(transition_date);
  const preStartDate = startDate;
  const preEndDate = transitionDate; // Pre-transition ends on the transition date itself
  const postStartDate = transitionDate; // Post-transition starts on the transition date itself
  const postEndDate = endDate;
  
  // Check if transition already exists to determine if we're updating
  const existing = await query(
    'SELECT id FROM employee_quarter_transitions WHERE employee_id = $1 AND cycle_id = $2 AND quarter = $3',
    [employeeId, cycleId, quarter]
  );
  
  const isUpdate = existing.rows.length > 0;
  const existingTransitionId = isUpdate ? existing.rows[0].id : null;
  
  // Upsert transition record (insert or update if exists)
  let result;
  try {
    if (isUpdate) {
      // Update existing transition
      result = await query(
        `UPDATE employee_quarter_transitions SET
          transition_type = $1::transition_type,
          transition_date = $2,
          old_manager_id = $3,
          new_manager_id = $4,
          old_department = $5,
          new_department = $6,
          old_project = $7,
          new_project = $8,
          old_grade = $9,
          new_grade = $10,
          updated_at = NOW()
        WHERE employee_id = $11 AND cycle_id = $12 AND quarter = $13
        RETURNING *`,
        [
          transition_type,
          transition_date,
          currentManager.managerId,
          finalNewManagerId,
          employee.department,
          new_department || employee.department,
          null, // old_project (not tracked currently)
          new_project,
          employee.grade,
          new_grade || employee.grade,
          employeeId,
          cycleId,
          quarter
        ]
      );
    } else {
      // Insert new transition
      result = await query(
        `INSERT INTO employee_quarter_transitions (
          employee_id, cycle_id, quarter, transition_type, transition_date,
          old_manager_id, new_manager_id, old_department, new_department,
          old_project, new_project, old_grade, new_grade, created_by
        ) VALUES ($1, $2, $3, $4::transition_type, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *`,
        [
          employeeId,
          cycleId,
          quarter,
          transition_type,
          transition_date,
          currentManager.managerId,
          finalNewManagerId,
          employee.department,
          new_department || employee.department,
          null, // old_project (not tracked currently)
          new_project,
          employee.grade,
          new_grade || employee.grade,
          createdBy
        ]
      );
    }
    
    if (!result.rows || result.rows.length === 0) {
      throw new Error(`Failed to ${isUpdate ? 'update' : 'create'} transition - no data returned`);
    }
    
    const transition = result.rows[0];
    
    // Insert into manager_history table to track manager changes
    // This ensures we have historical record even if employees.manager_code is updated later
    // Directly link to transition via transition_id for proper relationship
    // Only insert if manager actually changed (old_manager_id !== new_manager_id)
    if (currentManager.managerId !== finalNewManagerId) {
      try {
        await query(
          `INSERT INTO manager_history (
            employee_id, old_manager_id, new_manager_id, effective_date, changed_by, transition_id
          ) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT DO NOTHING`,
          [
            employeeId,
            currentManager.managerId,
            finalNewManagerId,
            transition_date,
            createdBy,
            transition.id  // Direct link to transition
          ]
        );
        console.log(`Manager history recorded for employee ${employeeId} on ${transition_date} linked to transition ${transition.id}`);
      } catch (historyError) {
        // Log but don't fail the transition creation if history insert fails
        console.error('Error inserting into manager_history:', historyError);
        // Check if it's a unique constraint violation (already exists) - that's okay
        if (!historyError.message || !historyError.message.includes('unique')) {
          console.warn('Manager history not recorded, but transition created successfully');
        }
      }
    }
    
    // Close old period goals (always update to ensure goals are properly marked)
    await closeOldPeriodGoals(employeeId, cycleId, quarter, transition.id);
    
    return transition;
  } catch (error) {
    // Provide more helpful error message
    if (error.message && error.message.includes('does not exist')) {
      throw new Error(`Database table or column missing. Please ensure migration 021_add_mid_quarter_transitions.sql has been run. Original error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Close old period goals (set to locked status)
 */
async function closeOldPeriodGoals(employeeId, cycleId, quarter, transitionId) {
  // Get transition date first
  const transitionResult = await query(
    'SELECT transition_date FROM employee_quarter_transitions WHERE id = $1',
    [transitionId]
  );
  
  if (transitionResult.rows.length === 0) {
    throw new Error(`Transition ${transitionId} not found`);
  }
  
  const transitionDate = transitionResult.rows[0].transition_date;
  
  // Get quarter start and end dates from quarterly_cycles table
  // Note: quarterly_start_date/quarterly_end_date were removed from goals_quarterly_cycles
  // Dates are now stored in quarterly_cycles as quarter_start_date/quarter_end_date
  const quarterRangeResult = await query(
    `SELECT quarter_start_date, quarter_end_date 
     FROM quarterly_cycles 
     WHERE performance_cycle_id = $1 AND quarter = $2`,
    [cycleId, quarter]
  );
  
  let periodStartDate = transitionDate; // Fallback to transition date
  let periodEndDate = transitionDate; // Pre-transition ends on the transition date itself
  
  if (quarterRangeResult.rows.length > 0) {
    periodStartDate = quarterRangeResult.rows[0].quarter_start_date;
  }
  
  // Ensure both dates are Date objects before calling toISOString
  const periodStartDateObj = periodStartDate instanceof Date 
    ? periodStartDate 
    : new Date(periodStartDate);
  const periodEndDateObj = periodEndDate instanceof Date 
    ? periodEndDate 
    : new Date(periodEndDate);
  
  const periodStartDateStr = periodStartDateObj.toISOString().split('T')[0];
  const periodEndDateStr = periodEndDateObj.toISOString().split('T')[0];
  
  // Calculate transition date time (end of transition date) for comparison
  // Use <= to include goals/KRAs created on the transition date (they are still pre-transition)
  const transitionDateTime = new Date(transitionDate);
  transitionDateTime.setHours(23, 59, 59, 999); // End of transition date
  
  // Update KRAs - filter by employee, cycle, quarter, and created on or before transition date
  const krasUpdateResult = await query(
    `UPDATE kras 
     SET status = 'locked', 
         period_type = 'pre_transition'::period_type,
         transition_id = $1,
         period_start_date = $2,
         period_end_date = $3
     WHERE employee_id = $4 
       AND cycle_id = $5
       AND quarter = $6
       AND created_at <= $7
       AND (status = 'draft' OR status = 'submitted' OR status = 'approved')
       AND (period_type IS NULL OR period_type = 'full_quarter'::period_type)`,
    [transitionId, periodStartDateStr, periodEndDateStr, employeeId, cycleId, quarter, transitionDateTime]
  );
  console.log(`Updated ${krasUpdateResult.rowCount} KRAs for transition ${transitionId}`);
  
  // Update Goals - filter by employee, cycle, quarter, and created on or before transition date
  // Use date comparison to handle timezone issues and include goals created on transition date
  const goalsUpdateResult = await query(
    `UPDATE goals 
     SET status = 'locked',
         period_type = 'pre_transition'::period_type,
         transition_id = $1,
         period_start_date = $2,
         period_end_date = $3
     WHERE employee_id = $4 
       AND cycle_id = $5
       AND quarter = $6
       AND created_at::date <= $7::date
       AND (status = 'draft' OR status = 'submitted' OR status = 'approved' OR status = 'locked')
       AND (period_type IS NULL OR period_type = 'full_quarter'::period_type OR (period_type = 'pre_transition'::period_type AND transition_id IS NULL))`,
    [transitionId, periodStartDateStr, periodEndDateStr, employeeId, cycleId, quarter, transitionDate]
  );
  console.log(`Updated ${goalsUpdateResult.rowCount} goals for transition ${transitionId}`);
  
  // If no goals were updated, try without quarter filter (in case some goals have NULL quarter)
  if (goalsUpdateResult.rowCount === 0) {
    const goalsWithoutQuarterFilter = await query(
      `UPDATE goals 
       SET status = 'locked',
           period_type = 'pre_transition'::period_type,
           transition_id = $1,
           period_start_date = $2,
           period_end_date = $3,
           quarter = $4
       WHERE employee_id = $5 
         AND cycle_id = $6
         AND quarter IS NULL
         AND created_at::date <= $7::date
         AND (status = 'draft' OR status = 'submitted' OR status = 'approved')
         AND (period_type IS NULL OR period_type = 'full_quarter'::period_type)`,
      [transitionId, periodStartDateStr, periodEndDateStr, quarter, employeeId, cycleId, transitionDate]
    );
    if (goalsWithoutQuarterFilter.rowCount > 0) {
      console.log(`Updated ${goalsWithoutQuarterFilter.rowCount} goals with NULL quarter for transition ${transitionId}`);
    }
  }
  
  // If no goals were updated, log for debugging
  if (goalsUpdateResult.rowCount === 0) {
    const goalsCheck = await query(
      `SELECT id, status, period_type, transition_id, quarter, created_at::date as created_date 
       FROM goals 
       WHERE employee_id = $1 AND cycle_id = $2 AND quarter = $3
       LIMIT 10`,
      [employeeId, cycleId, quarter]
    );
    console.log(`No goals updated. Found ${goalsCheck.rows.length} goals for employee ${employeeId}, cycle ${cycleId}, quarter ${quarter}:`, 
      goalsCheck.rows.map(g => ({ 
        id: g.id, 
        status: g.status, 
        period_type: g.period_type,
        transition_id: g.transition_id,
        quarter: g.quarter,
        created_date: g.created_date 
      }))
    );
    
    // Check how many goals match the WHERE conditions
    const matchingGoals = await query(
      `SELECT COUNT(*) as count
       FROM goals 
       WHERE employee_id = $1 
         AND cycle_id = $2 
         AND quarter = $3
         AND created_at::date <= $4::date
         AND (status = 'draft' OR status = 'submitted' OR status = 'approved')
         AND (period_type IS NULL OR period_type = 'full_quarter'::period_type)`,
      [employeeId, cycleId, quarter, transitionDate]
    );
    console.log(`Goals matching update criteria: ${matchingGoals.rows[0]?.count || 0}`);
  } else {
    // Verify the update worked
    const verifyGoals = await query(
      `SELECT id, transition_id, period_type, period_start_date, period_end_date 
       FROM goals 
       WHERE employee_id = $1 AND cycle_id = $2 AND quarter = $3 AND transition_id = $4
       LIMIT 5`,
      [employeeId, cycleId, quarter, transitionId]
    );
    console.log(`Verified ${verifyGoals.rows.length} goals with transition_id ${transitionId}:`, 
      verifyGoals.rows.map(g => ({
        id: g.id,
        transition_id: g.transition_id,
        period_type: g.period_type,
        period_start_date: g.period_start_date,
        period_end_date: g.period_end_date
      }))
    );
  }

  // Use the quarter parameter that was passed to the function
  if (!quarter) {
    console.warn(`No quarter provided for transition ${transitionId}, skipping review updates`);
  } else {
    // Update quarterly_self_reviews - mark existing reviews as pre_transition
    const selfReviewsUpdateResult = await query(
      `UPDATE quarterly_self_reviews 
       SET period_type = 'pre_transition'::period_type,
           transition_id = $1,
           period_start_date = $2,
           period_end_date = $3
       WHERE employee_id = $4 
         AND cycle_id = $5
         AND quarter = $6
         AND (period_type IS NULL OR period_type = 'full_quarter'::period_type)
         AND created_at::date <= $7::date`,
      [transitionId, periodStartDateStr, periodEndDateStr, employeeId, cycleId, quarter, transitionDate]
    );
    console.log(`Updated ${selfReviewsUpdateResult.rowCount} quarterly_self_reviews for transition ${transitionId}`);

    // Update quarterly_manager_reviews - mark existing reviews as pre_transition
    // Also set is_old_manager_review = true for reviews by the old manager
    const transitionDetails = await query(
      `SELECT old_manager_id FROM employee_quarter_transitions WHERE id = $1`,
      [transitionId]
    );
    const oldManagerId = transitionDetails.rows[0]?.old_manager_id;

    const managerReviewsUpdateResult = await query(
      `UPDATE quarterly_manager_reviews 
       SET period_type = 'pre_transition'::period_type,
           transition_id = $1,
           period_start_date = $2,
           period_end_date = $3,
           is_old_manager_review = CASE 
             WHEN reviewer_id = $4 THEN true 
             ELSE is_old_manager_review 
           END
       WHERE employee_id = $5 
         AND cycle_id = $6
         AND quarter = $7
         AND (period_type IS NULL OR period_type = 'full_quarter'::period_type)
         AND created_at::date <= $8::date`,
      [transitionId, periodStartDateStr, periodEndDateStr, oldManagerId, employeeId, cycleId, quarter, transitionDate]
    );
    console.log(`Updated ${managerReviewsUpdateResult.rowCount} quarterly_manager_reviews for transition ${transitionId}`);
  }
  
  // Mark transition as closed
  await query(
    'UPDATE employee_quarter_transitions SET old_period_closed = true WHERE id = $1',
    [transitionId]
  );
}

/**
 * Get transition by ID
 */
export async function getTransitionById(transitionId) {
  const result = await query(
    `SELECT t.*, 
            e1.full_name as old_manager_name,
            e2.full_name as new_manager_name
     FROM employee_quarter_transitions t
     LEFT JOIN employees e1 ON t.old_manager_id = e1.id
     LEFT JOIN employees e2 ON t.new_manager_id = e2.id
     WHERE t.id = $1`,
    [transitionId]
  );
  
  return result.rows[0] || null;
}

/**
 * Get transitions for employee
 */
export async function getEmployeeTransitions(employeeId, cycleId = null, quarter = null) {
  let sql = `
    SELECT t.*, 
           e.full_name as name,
           e.emp_code,
           e1.full_name as old_manager_name,
           e2.full_name as new_manager_name
    FROM employee_quarter_transitions t
    LEFT JOIN employees e ON t.employee_id = e.id
    LEFT JOIN employees e1 ON t.old_manager_id = e1.id
    LEFT JOIN employees e2 ON t.new_manager_id = e2.id
    WHERE t.employee_id = $1
  `;
  const params = [employeeId];
  let paramIndex = 2;
  
  if (cycleId) {
    sql += ` AND t.cycle_id = $${paramIndex++}`;
    params.push(cycleId);
  }
  
  if (quarter) {
    sql += ` AND t.quarter = $${paramIndex++}`;
    params.push(quarter);
  }
  
  sql += ' ORDER BY t.transition_date DESC';
  
  const result = await query(sql, params);
  return result.rows;
}

/**
 * Get all transitions (for admin)
 */
export async function getAllTransitions(cycleId = null, quarter = null) {
  let sql = `
    SELECT t.*, 
           e.full_name as name,
           e.emp_code,
           e.email,
           e.department,
           e.grade,
           e1.full_name as old_manager_name,
           e2.full_name as new_manager_name
    FROM employee_quarter_transitions t
    LEFT JOIN employees e ON t.employee_id = e.id
    LEFT JOIN employees e1 ON t.old_manager_id = e1.id
    LEFT JOIN employees e2 ON t.new_manager_id = e2.id
    WHERE 1=1
  `;
  const params = [];
  let paramIndex = 1;
  
  if (cycleId) {
    sql += ` AND t.cycle_id = $${paramIndex++}`;
    params.push(cycleId);
  }
  
  if (quarter) {
    sql += ` AND t.quarter = $${paramIndex++}`;
    params.push(quarter);
  }
  
  sql += ' ORDER BY t.transition_date DESC, e.full_name ASC';
  
  const result = await query(sql, params);
  return result.rows;
}

/**
 * Update transition status
 */
export async function updateTransitionStatus(transitionId, statusUpdates) {
  const updates = [];
  const values = [];
  let paramIndex = 1;
  
  if (statusUpdates.old_period_reviewed !== undefined) {
    updates.push(`old_period_reviewed = $${paramIndex++}`);
    values.push(statusUpdates.old_period_reviewed);
  }
  if (statusUpdates.new_period_goals_set !== undefined) {
    updates.push(`new_period_goals_set = $${paramIndex++}`);
    values.push(statusUpdates.new_period_goals_set);
  }
  if (statusUpdates.new_period_approved !== undefined) {
    updates.push(`new_period_approved = $${paramIndex++}`);
    values.push(statusUpdates.new_period_approved);
  }
  
  if (updates.length === 0) {
    return null;
  }
  
  updates.push(`updated_at = NOW()`);
  values.push(transitionId);
  
  const result = await query(
    `UPDATE employee_quarter_transitions 
     SET ${updates.join(', ')} 
     WHERE id = $${paramIndex} 
     RETURNING *`,
    values
  );
  
  return result.rows[0] || null;
}

/**
 * Update transition data (for admin editing)
 */
export async function updateTransition(transitionId, transitionData) {
  const {
    transition_type,
    transition_date,
    new_manager_id,
    new_department,
    new_grade,
    new_project
  } = transitionData;
  
  // Get the existing transition to get employee_id, cycle_id, quarter
  const existing = await getTransitionById(transitionId);
  if (!existing) {
    throw new Error('Transition not found');
  }
  
  // Get current employee details
  const employee = await getEmployeeDetails(existing.employee_id);
  const currentManager = await getEmployeeManager(existing.employee_id);
  
  // Normalize new_manager_id - if null, set to old_manager_id
  let finalNewManagerId = new_manager_id;
  if (!finalNewManagerId && currentManager.managerId) {
    finalNewManagerId = currentManager.managerId;
  } else if (finalNewManagerId && finalNewManagerId === currentManager.managerId) {
    finalNewManagerId = currentManager.managerId;
  }
  
  // Update transition
  const result = await query(
    `UPDATE employee_quarter_transitions SET
      transition_type = $1::transition_type,
      transition_date = $2,
      new_manager_id = $3,
      new_department = $4,
      new_project = $5,
      new_grade = $6,
      updated_at = NOW()
    WHERE id = $7
    RETURNING *`,
    [
      transition_type,
      transition_date,
      finalNewManagerId,
      new_department || employee.department,
      new_project,
      new_grade || employee.grade,
      transitionId
    ]
  );
  
  if (!result.rows || result.rows.length === 0) {
    throw new Error('Failed to update transition');
  }
  
  return result.rows[0];
}

/**
 * Check if employee has transition for quarter
 */
export async function hasTransition(employeeId, cycleId, quarter) {
  const result = await query(
    'SELECT id FROM employee_quarter_transitions WHERE employee_id = $1 AND cycle_id = $2 AND quarter = $3',
    [employeeId, cycleId, quarter]
  );
  
  return result.rows.length > 0;
}

/**
 * Get transition for employee and quarter
 */
export async function getTransitionForQuarter(employeeId, cycleId, quarter) {
  const result = await query(
    `SELECT t.*, 
            e1.full_name as old_manager_name,
            e2.full_name as new_manager_name
     FROM employee_quarter_transitions t
     LEFT JOIN employees e1 ON t.old_manager_id = e1.id
     LEFT JOIN employees e2 ON t.new_manager_id = e2.id
     WHERE t.employee_id = $1 AND t.cycle_id = $2 AND t.quarter = $3`,
    [employeeId, cycleId, quarter]
  );
  
  return result.rows[0] || null;
}

/**
 * Check if employee has an active transition for the given cycle and quarter
 * This is used to bypass date validations for transitions
 */
export async function hasActiveTransition(employeeId, cycleId, quarter) {
  const result = await query(
    'SELECT id FROM employee_quarter_transitions WHERE employee_id = $1 AND cycle_id = $2 AND quarter = $3',
    [employeeId, cycleId, quarter]
  );
  
  return result.rows.length > 0;
}
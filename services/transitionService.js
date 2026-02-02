import { query } from '../config/database.js';

/**
 * Transition Service
 * Handles mid-quarter employee transitions (promotions, project changes, role changes)
 * Follows DRY and KISS principles
 */

/**
 * Get quarter date range from cycle
 */
async function getQuarterDateRange(cycleId, quarter) {
  // Try quarterly_cycles table first (if it exists)
  let cycleResult = await query(
    `SELECT quarter_start_date, quarter_end_date 
     FROM quarterly_cycles 
     WHERE performance_cycle_id = $1 AND quarter = $2`,
    [cycleId, quarter]
  );
  
  // If quarterly_cycles doesn't have the data, try goals_quarterly_cycles
  if (cycleResult.rows.length === 0) {
    cycleResult = await query(
      `SELECT quarterly_start_date as quarter_start_date, quarterly_end_date as quarter_end_date 
       FROM goals_quarterly_cycles 
       WHERE performance_cycle_id = $1 AND quarter = $2`,
      [cycleId, quarter]
    );
  }
  
  // If still no data, calculate from performance_cycles year (fallback)
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
  
  // Validate transition date
  const { startDate, endDate } = await validateTransitionDate(cycleId, quarter, transition_date);
  
  // Get current employee details
  const employee = await getEmployeeDetails(employeeId);
  const currentManager = await getEmployeeManager(employeeId);
  
  // If new_manager_id is same as current manager, set to null (manager didn't change)
  // This ensures consistent handling - if manager is same, we don't track it as a change
  const finalNewManagerId = (normalizedNewManagerId && normalizedNewManagerId === currentManager.managerId) 
    ? null 
    : normalizedNewManagerId;
  
  // Get new manager details if provided and different from current
  let newManagerCode = null;
  if (finalNewManagerId) {
    const newManager = await getEmployeeDetails(finalNewManagerId);
    newManagerCode = newManager.emp_code;
  }
  
  // Check if transition already exists
  const existing = await query(
    'SELECT id FROM employee_quarter_transitions WHERE employee_id = $1 AND cycle_id = $2 AND quarter = $3',
    [employeeId, cycleId, quarter]
  );
  
  if (existing.rows.length > 0) {
    throw new Error(`Transition already exists for employee ${employeeId} in cycle ${cycleId}, quarter ${quarter}`);
  }
  
  // Calculate period dates
  const transitionDate = new Date(transition_date);
  const preStartDate = startDate;
  const preEndDate = new Date(transitionDate);
  preEndDate.setDate(preEndDate.getDate() - 1); // Day before transition
  const postStartDate = transitionDate;
  const postEndDate = endDate;
  
  // Create transition record
  let result;
  try {
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
  } catch (error) {
    // Provide more helpful error message
    if (error.message && error.message.includes('does not exist')) {
      throw new Error(`Database table or column missing. Please ensure migration 021_add_mid_quarter_transitions.sql has been run. Original error: ${error.message}`);
    }
    throw error;
  }
  
  if (!result.rows || result.rows.length === 0) {
    throw new Error('Failed to create transition - no data returned');
  }
  
  const transition = result.rows[0];
  
  // Close old period goals
  await closeOldPeriodGoals(employeeId, cycleId, quarter, transition.id);
  
  return transition;
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
  
  // Get quarter start and end dates from goals_quarterly_cycles
  const quarterRangeResult = await query(
    `SELECT quarterly_start_date, quarterly_end_date 
     FROM goals_quarterly_cycles 
     WHERE performance_cycle_id = $1 AND quarter = $2`,
    [cycleId, quarter]
  );
  
  let periodStartDate = transitionDate; // Fallback to transition date
  let periodEndDate = new Date(transitionDate);
  periodEndDate.setDate(periodEndDate.getDate() - 1); // Day before transition
  
  if (quarterRangeResult.rows.length > 0) {
    periodStartDate = quarterRangeResult.rows[0].quarterly_start_date;
  } else {
    // Fallback: try quarterly_cycles table
    const altQuarterRangeResult = await query(
      `SELECT quarter_start_date as quarterly_start_date, quarter_end_date as quarterly_end_date 
       FROM quarterly_cycles 
       WHERE performance_cycle_id = $1 AND quarter = $2`,
      [cycleId, quarter]
    );
    if (altQuarterRangeResult.rows.length > 0) {
      periodStartDate = altQuarterRangeResult.rows[0].quarterly_start_date;
    }
  }
  
  const periodStartDateStr = periodStartDate instanceof Date 
    ? periodStartDate.toISOString().split('T')[0] 
    : new Date(periodStartDate).toISOString().split('T')[0];
  const periodEndDateStr = periodEndDate.toISOString().split('T')[0];
  
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
           e1.full_name as old_manager_name,
           e2.full_name as new_manager_name
    FROM employee_quarter_transitions t
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

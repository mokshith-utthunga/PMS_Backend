import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = express.Router();


router.get('/late-submission', authMiddleware, requireRole(['hr_admin', 'system_admin']), async (req, res) => {
  try {
    const { employee_id, cycle_id, revoked_at, quarter = 1, type = 'goals' } = req.query;
    
    // If cycle_id is provided, get employees who haven't submitted + existing permissions
    if (cycle_id) {
      const isYearEnd = quarter === 'year-end';
      const quarterNum = isYearEnd ? null : (parseInt(quarter) || 1);
      
      // Get dates based on type (goals or evaluations)
      let startDate = null;
      
      if (isYearEnd) {
        // Get year-end dates from Q4 quarterly_cycles (manager review dates are used for year-end)
        const q4Result = await query(
          `SELECT manager_review_start_date, manager_review_end_date FROM quarterly_cycles WHERE performance_cycle_id = $1 AND quarter = 4`,
          [cycle_id]
        );
        
        if (q4Result.rows.length === 0) {
          // Check if cycle exists
          const cycleExistsResult = await query(
            `SELECT id FROM performance_cycles WHERE id = $1`,
            [cycle_id]
          );
          if (cycleExistsResult.rows.length === 0) {
            return res.status(404).json({ error: 'Cycle not found' });
          }
        } else {
          startDate = q4Result.rows[0].manager_review_start_date;
        }
      } else if (type === 'goals') {
        // Get goal dates from goals_quarterly_cycles table
        const gqcResult = await query(
          `SELECT goal_submission_start_date, goal_submission_end_date 
           FROM goals_quarterly_cycles 
           WHERE performance_cycle_id = $1 AND quarter = $2`,
          [cycle_id, quarterNum]
        );
        
        if (gqcResult.rows.length > 0) {
          startDate = gqcResult.rows[0].goal_submission_start_date;
        } else {
          // Check if cycle exists
          const cycleExistsResult = await query(
            `SELECT id FROM performance_cycles WHERE id = $1`,
            [cycle_id]
          );
          if (cycleExistsResult.rows.length === 0) {
            return res.status(404).json({ error: 'Cycle not found' });
          }
        }
      } else {
        // Get evaluation dates from quarterly_cycles table
        const qcResult = await query(
          `SELECT self_review_start_date, self_review_end_date 
           FROM quarterly_cycles 
           WHERE performance_cycle_id = $1 AND quarter = $2`,
          [cycle_id, quarterNum]
        );
        
        if (qcResult.rows.length > 0) {
          startDate = qcResult.rows[0].self_review_start_date;
        } else {
          // Check if cycle exists
          const cycleExistsResult = await query(
            `SELECT id FROM performance_cycles WHERE id = $1`,
            [cycle_id]
          );
          if (cycleExistsResult.rows.length === 0) {
            return res.status(404).json({ error: 'Cycle not found' });
          }
        }
      }
      
      // Get all active employees who joined BEFORE or ON the start date
      // Employees who joined after the period started should not be shown as "missed deadline"
      // Include manager information via LEFT JOIN
      const employeesResult = await query(
        `SELECT DISTINCT e.id, e.emp_code, e.full_name, e.email, e.department, e.date_of_joining, e.manager_code,
                m.id as manager_id, m.emp_code as manager_emp_code, m.full_name as manager_name
         FROM employees e
         LEFT JOIN employees m ON m.emp_code = e.manager_code
         WHERE e.status = 'active'
         ${startDate ? `AND e.date_of_joining <= $1` : ''}
         ORDER BY e.full_name`,
        startDate ? [startDate] : []
      );
      
      // Get employees who have submitted
      // For year-end: check self_evaluations table where quarter IS NULL
      // For quarters: check quarterly_self_reviews table
      let submittedResult;
      if (isYearEnd) {
        submittedResult = await query(
          `SELECT DISTINCT employee_id 
           FROM self_evaluations 
           WHERE cycle_id = $1 AND quarter IS NULL AND status = 'submitted'`,
          [cycle_id]
        );
      } else {
        submittedResult = await query(
          `SELECT DISTINCT employee_id 
           FROM quarterly_self_reviews 
           WHERE cycle_id = $1 AND quarter = $2 AND status = 'submitted'`,
          [cycle_id, quarterNum]
        );
      }
      const submittedEmployeeIds = new Set(submittedResult.rows.map(r => r.employee_id));
      
      // Get existing late submission permissions for this cycle AND quarter
      // For year-end, check for NULL quarter (year-end permissions are stored with NULL)
      // For quarters, check for specific quarter or NULL (applies to all quarters)
      let permissionsSql, permissionsParams;
      if (isYearEnd) {
        // For year-end, check for quarter IS NULL
        permissionsSql = `SELECT * FROM late_submission_permissions 
                         WHERE cycle_id = $1 AND quarter IS NULL`;
        permissionsParams = [cycle_id];
      } else {
        permissionsSql = `SELECT * FROM late_submission_permissions 
                         WHERE cycle_id = $1 AND (quarter = $2 OR quarter IS NULL)`;
        permissionsParams = [cycle_id, quarterNum];
      }
      let paramIdx = permissionsParams.length + 1;
      
      if (employee_id) {
        permissionsSql += ` AND employee_id = $${paramIdx++}`;
        permissionsParams.push(employee_id);
      }
      
      if (revoked_at === 'null' || revoked_at === null) {
        permissionsSql += ' AND revoked_at IS NULL';
      } else if (revoked_at) {
        permissionsSql += ` AND revoked_at = $${paramIdx++}`;
        permissionsParams.push(revoked_at);
      }
      
      permissionsSql += ' ORDER BY granted_at DESC';
      const permissionsResult = await query(permissionsSql, permissionsParams);
      const permissionsMap = new Map();
      permissionsResult.rows.forEach(p => {
        // If employee has quarter-specific permission, use that; otherwise use null quarter permission
        const existingPerm = permissionsMap.get(p.employee_id);
        if (!existingPerm || (p.quarter !== null && existingPerm.quarter === null)) {
          permissionsMap.set(p.employee_id, p);
        }
      });
      
      // Build response: employees who haven't submitted + have permissions
      const response = [];
      
      for (const emp of employeesResult.rows) {
        const hasSubmitted = submittedEmployeeIds.has(emp.id);
        const hasPermission = permissionsMap.has(emp.id);
        
        // Include if: hasn't submitted OR has permission (and matches employee_id filter if provided)
        if (!hasSubmitted || hasPermission) {
          if (!employee_id || emp.id === employee_id) {
            response.push({
              employee_id: emp.id,
              emp_code: emp.emp_code,
              employee_name: emp.full_name,
              employee_email: emp.email,
              department: emp.department,
              date_of_joining: emp.date_of_joining,
              manager_code: emp.manager_code,
              manager_id: emp.manager_id,
              manager_emp_code: emp.manager_emp_code,
              manager_name: emp.manager_name,
              has_submitted: hasSubmitted,
              permission: hasPermission ? permissionsMap.get(emp.id) : null,
              needs_permission: !hasSubmitted && !hasPermission
            });
          }
        }
      }
      
      return res.json({ data: response });
    }
    
    // If no cycle_id, just return existing permissions (original behavior)
    let sql = 'SELECT * FROM late_submission_permissions WHERE 1=1';
    const params = [];
    let idx = 1;

    if (employee_id) {
      sql += ` AND employee_id = $${idx++}`;
      params.push(employee_id);
    }

    // Handle revoked_at filter - if 'null' is passed, filter for non-revoked permissions
    if (revoked_at === 'null' || revoked_at === null) {
      sql += ' AND revoked_at IS NULL';
    } else if (revoked_at) {
      sql += ` AND revoked_at = $${idx++}`;
      params.push(revoked_at);
    }

    sql += ' ORDER BY granted_at DESC';
    
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Get late submission permissions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/permissions/late-submission/check - Check if current user has late submission permission
// Accessible to all authenticated users (for checking their own permission)
router.get('/late-submission/check', authMiddleware, async (req, res) => {
  try {
    const { cycle_id, quarter } = req.query;
    
    if (!cycle_id) {
      return res.status(400).json({ error: 'cycle_id is required' });
    }

    // Get current user's employee ID
    const employeeResult = await query(
      'SELECT id FROM employees WHERE profile_id = $1',
      [req.user.userId]
    );

    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Employee profile not found' });
    }

    const employeeId = employeeResult.rows[0].id;
    const quarterNum = quarter ? parseInt(quarter) : null;

    // Check if employee has active late submission permission
    // Check for either quarter-specific permission OR null quarter (applies to all)
    let sql = `SELECT * FROM late_submission_permissions 
               WHERE employee_id = $1 AND cycle_id = $2 AND revoked_at IS NULL`;
    const params = [employeeId, cycle_id];
    
    if (quarterNum) {
      sql += ` AND (quarter = $3 OR quarter IS NULL)`;
      params.push(quarterNum);
    }
    
    const result = await query(sql, params);
    
    res.json({ data: result.rows, hasPermission: result.rows.length > 0 });
  } catch (error) {
    console.error('Check late submission permission error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/permissions/late-submission/:id - Get a single late submission permission
// Restricted to HR Admin and System Admin
router.get('/late-submission/:id', authMiddleware, requireRole(['hr_admin', 'system_admin']), async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM late_submission_permissions WHERE id = $1',
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Late submission permission not found' });
    }
    
    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Get single late submission permission error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/permissions/late-submission - Create a late submission permission
// Restricted to HR Admin and System Admin
router.post('/late-submission', authMiddleware, requireRole(['hr_admin', 'system_admin']), async (req, res) => {
  try {
    const { employee_id, cycle_id, expires_at, reason, granted_by, quarter } = req.body;
    
    if (!employee_id || !cycle_id) {
      return res.status(400).json({ error: 'employee_id and cycle_id are required' });
    }

    // Parse quarter - handle "year-end" as special case
    const isYearEnd = quarter === 'year-end';
    let quarterNum = null;
    if (!isYearEnd && quarter) {
      quarterNum = parseInt(quarter);
      if (quarterNum < 1 || quarterNum > 4) {
        return res.status(400).json({ error: 'quarter must be between 1 and 4, or "year-end"' });
      }
    }
    // For year-end, quarterNum remains null
    
    // Check if permission already exists for this employee, cycle, and quarter
    // For year-end (NULL), we need special handling to distinguish from "all quarters"
    // We'll use a different comparison: for year-end, check for NULL quarter specifically
    let existingCheck;
    if (isYearEnd) {
      existingCheck = await query(
        `SELECT id, revoked_at FROM late_submission_permissions 
         WHERE employee_id = $1 AND cycle_id = $2 AND quarter IS NULL`,
        [employee_id, cycle_id]
      );
    } else {
      existingCheck = await query(
        `SELECT id, revoked_at FROM late_submission_permissions 
         WHERE employee_id = $1 AND cycle_id = $2 AND COALESCE(quarter, 0) = $3`,
        [employee_id, cycle_id, quarterNum ?? 0]
      );
    }
    
    if (existingCheck.rows.length > 0) {
      const existing = existingCheck.rows[0];
      
      // If permission exists and is not revoked, return error
      if (!existing.revoked_at) {
        return res.status(409).json({ 
          error: `Late submission permission already exists for this employee${isYearEnd ? ' for year-end evaluation' : (quarterNum ? ` for Q${quarterNum}` : ' for all quarters')}` 
        });
      }
      
      // If permission exists but was revoked, update it instead of creating new
      const result = await query(
        `UPDATE late_submission_permissions 
         SET granted_by = $1, expires_at = $2, reason = $3, revoked_at = NULL, granted_at = NOW(), quarter = $4
         WHERE id = $5
         RETURNING *`,
        [granted_by || req.user.userId, expires_at || null, reason || null, quarterNum, existing.id]
      );
      
      return res.status(200).json({ data: result.rows[0] });
    }
    
    // Create new permission
    const result = await query(
      `INSERT INTO late_submission_permissions 
       (employee_id, cycle_id, granted_by, expires_at, reason, quarter)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [employee_id, cycle_id, granted_by || req.user.userId, expires_at || null, reason || null, quarterNum]
    );
    
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    console.error('Create late submission permission error:', error);
    
    // Handle unique constraint violation
    if (error.code === '23505') { // PostgreSQL unique violation
      return res.status(409).json({ 
        error: 'Late submission permission already exists for this employee and quarter' 
      });
    }
    
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/permissions/late-submission/:id - Update a late submission permission
// Restricted to HR Admin and System Admin
router.put('/late-submission/:id', authMiddleware, requireRole(['hr_admin', 'system_admin']), async (req, res) => {
  try {
    const { expires_at, reason, revoked_at } = req.body;
    
    const result = await query(
      `UPDATE late_submission_permissions 
       SET expires_at = COALESCE($1, expires_at),
           reason = COALESCE($2, reason),
           revoked_at = $3
       WHERE id = $4
       RETURNING *`,
      [expires_at ?? null, reason ?? null, revoked_at ?? null, req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Late submission permission not found' });
    }
    
    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Update late submission permission error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/permissions/late-submission/:id - Revoke a late submission permission by ID
// Restricted to HR Admin and System Admin
router.delete('/late-submission/:id', authMiddleware, requireRole(['hr_admin', 'system_admin']), async (req, res) => {
  try {
    // Soft delete by setting revoked_at
    const result = await query(
      `UPDATE late_submission_permissions 
       SET revoked_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Late submission permission not found' });
    }
    
    res.json({ message: 'Late submission permission revoked', data: result.rows[0] });
  } catch (error) {
    console.error('Revoke late submission permission error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/permissions/late-submission/:cycleId/:employeeId/revoke - Revoke by cycle and employee
// Supports quarter-specific revocation
// Restricted to HR Admin and System Admin
router.put('/late-submission/:cycleId/:employeeId/revoke', authMiddleware, requireRole(['hr_admin', 'system_admin']), async (req, res) => {
  try {
    const { cycleId, employeeId } = req.params;
    const { quarter } = req.body;
    
    // Parse quarter - handle "year-end" as special case
    const isYearEnd = quarter === 'year-end';
    const quarterNum = isYearEnd ? null : (quarter ? parseInt(quarter) : null);
    
    // Build query based on whether quarter is specified
    let sql, params;
    if (isYearEnd) {
      // Revoke year-end permission (NULL quarter)
      sql = `UPDATE late_submission_permissions 
             SET revoked_at = NOW()
             WHERE cycle_id = $1 AND employee_id = $2 AND quarter IS NULL AND revoked_at IS NULL
             RETURNING *`;
      params = [cycleId, employeeId];
    } else if (quarterNum !== null) {
      // Revoke specific quarter permission
      sql = `UPDATE late_submission_permissions 
             SET revoked_at = NOW()
             WHERE cycle_id = $1 AND employee_id = $2 AND (quarter = $3 OR quarter IS NULL) AND revoked_at IS NULL
             RETURNING *`;
      params = [cycleId, employeeId, quarterNum];
    } else {
      // Revoke all permissions for this cycle and employee
      sql = `UPDATE late_submission_permissions 
             SET revoked_at = NOW()
             WHERE cycle_id = $1 AND employee_id = $2 AND revoked_at IS NULL
             RETURNING *`;
      params = [cycleId, employeeId];
    }
    
    const result = await query(sql, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No active late submission permission found' });
    }
    
    res.json({ message: 'Late submission permission revoked', data: result.rows });
  } catch (error) {
    console.error('Revoke late submission permission error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/permissions/late-submission-details - Get late submission statistics (Unified for Goals + Evaluations)
// Accepts optional 'type' parameter: 'goals' | 'evaluations' to determine which dates to check for quarter accessibility
// Restricted to HR Admin and System Admin
router.get('/late-submission-details', authMiddleware, requireRole(['hr_admin', 'system_admin']), async (req, res) => {
  try {
    const { cycle_id, quarter, type = 'goals' } = req.query;
    
    if (!cycle_id) {
      return res.status(400).json({ error: 'cycle_id is required' });
    }

    // Parse quarter - handle "year-end" as special case
    const isYearEnd = quarter === 'year-end';
    const quarterNum = isYearEnd ? null : (quarter ? parseInt(quarter) : 1);
    if (!isYearEnd && (quarterNum < 1 || quarterNum > 4)) {
      return res.status(400).json({ error: 'quarter must be between 1 and 4, or "year-end"' });
    }

    // Get performance cycle basic info
    const cycleResult = await query(
      `SELECT id, year, allow_late_goal_submission
       FROM performance_cycles 
       WHERE id = $1`,
      [cycle_id]
    );
    
    if (cycleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Cycle not found' });
    }

    const cycle = cycleResult.rows[0];
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    // ========== EVALUATIONS LOGIC ==========
    // Get evaluation dates from quarterly_cycles table
    let evalStartDate, evalEndDate;
    if (isYearEnd) {
      // For year-end evaluations, use Q4's dates from quarterly_cycles
      const q4Result = await query(
        `SELECT self_review_start_date, self_review_end_date, manager_review_start_date, manager_review_end_date 
         FROM quarterly_cycles 
         WHERE performance_cycle_id = $1 AND quarter = 4`,
        [cycle_id]
      );
      if (q4Result.rows.length > 0) {
        // Use Q4's manager review dates for year-end evaluation
        evalStartDate = q4Result.rows[0].manager_review_start_date;
        evalEndDate = q4Result.rows[0].manager_review_end_date;
      }
    } else {
      // Get from quarterly_cycles table
      const qcResult = await query(
        `SELECT self_review_start_date, self_review_end_date 
         FROM quarterly_cycles 
         WHERE performance_cycle_id = $1 AND quarter = $2`,
        [cycle_id, quarterNum]
      );
      
      if (qcResult.rows.length > 0) {
        evalStartDate = qcResult.rows[0].self_review_start_date;
        evalEndDate = qcResult.rows[0].self_review_end_date;
      }
    }

    // ========== GOALS LOGIC ==========
    // Get goals dates from goals_quarterly_cycles table
    let goalsStartDate, goalsEndDate, allowLateGoals;
    if (!isYearEnd) {
      // Get from goals_quarterly_cycles table
      const gqcResult = await query(
        `SELECT goal_submission_start_date, goal_submission_end_date, allow_late_goal_submission 
         FROM goals_quarterly_cycles 
         WHERE performance_cycle_id = $1 AND quarter = $2`,
        [cycle_id, quarterNum]
      );
      
      if (gqcResult.rows.length > 0) {
        goalsStartDate = gqcResult.rows[0].goal_submission_start_date;
        goalsEndDate = gqcResult.rows[0].goal_submission_end_date;
        allowLateGoals = gqcResult.rows[0].allow_late_goal_submission;
      } else {
        // Use global allow_late_goal_submission from performance_cycles
        allowLateGoals = cycle.allow_late_goal_submission;
      }
    } else {
      // Year-end: get Q4 goals dates
      const q4GoalsResult = await query(
        `SELECT goal_submission_start_date, goal_submission_end_date, allow_late_goal_submission 
         FROM goals_quarterly_cycles 
         WHERE performance_cycle_id = $1 AND quarter = 4`,
        [cycle_id]
      );
      
      if (q4GoalsResult.rows.length > 0) {
        goalsStartDate = q4GoalsResult.rows[0].goal_submission_start_date;
        goalsEndDate = q4GoalsResult.rows[0].goal_submission_end_date;
        allowLateGoals = q4GoalsResult.rows[0].allow_late_goal_submission;
      } else {
        allowLateGoals = cycle.allow_late_goal_submission;
      }
    }

    // ========== DETERMINE IF PERIODS HAVE STARTED ==========
    // Check if goals period has started
    let goalsHasStarted = false;
    if (goalsStartDate) {
      const goalsStart = new Date(goalsStartDate);
      goalsStart.setHours(0, 0, 0, 0);
      goalsHasStarted = now >= goalsStart;
    }

    // Check if evaluations period has started
    let evalHasStarted = false;
    if (evalStartDate) {
      const evalStart = new Date(evalStartDate);
      evalStart.setHours(0, 0, 0, 0);
      evalHasStarted = now >= evalStart;
    }

    // Calculate isPastDeadline for both types
    let evalIsPastDeadline = false;
    if (evalEndDate) {
      const evalEnd = new Date(evalEndDate);
      evalEnd.setHours(23, 59, 59, 999);
      evalIsPastDeadline = now > evalEnd;
    }

    let goalsIsPastDeadline = false;
    if (goalsEndDate) {
      const goalsEnd = new Date(goalsEndDate);
      goalsEnd.setHours(23, 59, 59, 999);
      goalsIsPastDeadline = now > goalsEnd;
    }

    // Total employees: Count of employees who were part of the organization at the start
    // Use the earlier of goals or evaluations start date
    const overallStartDate = goalsStartDate && evalStartDate 
      ? (new Date(goalsStartDate) < new Date(evalStartDate) ? goalsStartDate : evalStartDate)
      : (goalsStartDate || evalStartDate);

    const totalEmployeesResult = await query(
      `SELECT COUNT(*) as count FROM employees 
       WHERE status = 'active' ${overallStartDate ? `AND date_of_joining <= $1` : ''}`,
      overallStartDate ? [overallStartDate] : []
    );
    const totalEmployees = parseInt(totalEmployeesResult.rows[0]?.count || 0);

    // ========== EVALUATIONS STATS ==========
    let evalSubmittedResult;
    if (isYearEnd) {
      evalSubmittedResult = await query(
        `SELECT COUNT(DISTINCT se.employee_id) as count 
         FROM self_evaluations se
         JOIN employees e ON e.id = se.employee_id
         WHERE se.cycle_id = $1 AND se.quarter IS NULL AND se.status = 'submitted'
         ${evalStartDate ? `AND e.date_of_joining <= $2` : ''}`,
        evalStartDate ? [cycle_id, evalStartDate] : [cycle_id]
      );
    } else {
      evalSubmittedResult = await query(
        `SELECT COUNT(DISTINCT qsr.employee_id) as count 
         FROM quarterly_self_reviews qsr
         JOIN employees e ON e.id = qsr.employee_id
         WHERE qsr.cycle_id = $1 AND qsr.quarter = $2 AND qsr.status = 'submitted'
         ${evalStartDate ? `AND e.date_of_joining <= $3` : ''}`,
        evalStartDate ? [cycle_id, quarterNum, evalStartDate] : [cycle_id, quarterNum]
      );
    }
    const evalSubmitted = parseInt(evalSubmittedResult.rows[0]?.count || 0);
    const evalMissedDeadline = evalIsPastDeadline ? (totalEmployees - evalSubmitted) : 0;

    // Late access for evaluations
    let evalLateAccessResult;
    if (isYearEnd) {
      evalLateAccessResult = await query(
        `SELECT COUNT(*) as count 
         FROM late_submission_permissions 
         WHERE cycle_id = $1 AND revoked_at IS NULL AND quarter IS NULL`,
        [cycle_id]
      );
    } else {
      evalLateAccessResult = await query(
        `SELECT COUNT(*) as count 
         FROM late_submission_permissions 
         WHERE cycle_id = $1 AND revoked_at IS NULL AND (quarter = $2 OR quarter IS NULL)`,
        [cycle_id, quarterNum]
      );
    }
    const evalLateAccessGranted = parseInt(evalLateAccessResult.rows[0]?.count || 0);

    // ========== GOALS STATS ==========
    // Count employees who have submitted goals (status = 'submitted' or 'approved')
    const goalsSubmittedResult = await query(
      `SELECT COUNT(DISTINCT g.employee_id) as count 
       FROM goals g
       JOIN employees e ON e.id = g.employee_id
       WHERE g.cycle_id = $1 AND g.status IN ('submitted', 'approved')
       ${goalsStartDate ? `AND e.date_of_joining <= $2` : ''}`,
      goalsStartDate ? [cycle_id, goalsStartDate] : [cycle_id]
    );
    const goalsSubmitted = parseInt(goalsSubmittedResult.rows[0]?.count || 0);
    const goalsMissedDeadline = goalsIsPastDeadline ? (totalEmployees - goalsSubmitted) : 0;

    // Late access for goals - count actual individual permissions granted
    // Note: allow_late_goal_submission is a global toggle (returned separately if needed)
    // lateAccessGranted counts actual explicit permissions from late_submission_permissions table
    const goalsLateAccessResult = await query(
      `SELECT COUNT(*) as count 
       FROM late_submission_permissions 
       WHERE cycle_id = $1 AND revoked_at IS NULL ${isYearEnd ? 'AND quarter IS NULL' : `AND (quarter = $2 OR quarter IS NULL)`}`,
      isYearEnd ? [cycle_id] : [cycle_id, quarterNum]
    );
    const goalsLateAccessGranted = parseInt(goalsLateAccessResult.rows[0]?.count || 0);

    res.json({
      data: {
        totalEmployees,
        goals: {
          submitted: goalsHasStarted ? goalsSubmitted : 0,
          missedDeadline: goalsHasStarted ? goalsMissedDeadline : 0,
          lateAccessGranted: goalsHasStarted ? goalsLateAccessGranted : 0,
          allowLateSubmission: allowLateGoals || false, // Global toggle from goals_quarterly_cycles
          quarter: isYearEnd ? null : quarterNum,
          isPastDeadline: goalsIsPastDeadline,
          hasStarted: goalsHasStarted,
          startDate: goalsStartDate || null,
        },
        evaluations: {
          submitted: evalHasStarted ? evalSubmitted : 0,
          missedDeadline: evalHasStarted ? evalMissedDeadline : 0,
          lateAccessGranted: evalHasStarted ? evalLateAccessGranted : 0,
          quarter: isYearEnd ? null : quarterNum,
          isPastDeadline: evalIsPastDeadline,
          hasStarted: evalHasStarted,
          startDate: evalStartDate || null,
        }
      }
    });
  } catch (error) {
    console.error('Get late submission details error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

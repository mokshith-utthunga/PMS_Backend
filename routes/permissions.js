import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = express.Router();


router.get('/late-submission', authMiddleware, requireRole(['hr_admin', 'system_admin']), async (req, res) => {
  try {
    const { employee_id, cycle_id, revoked_at, quarter = 1, type = 'goals', role = 'employee' } = req.query;
    
    // If cycle_id is provided, get employees who haven't submitted + existing permissions
    if (cycle_id) {
      const isYearEnd = quarter === 'year-end';
      const quarterNum = isYearEnd ? null : (parseInt(quarter) || 1);
      
      // ========== MANAGER GOALS APPROVAL LOGIC ==========
      // For Manager tab with Goals: Show managers who have pending goal approvals
      // Handle both 'goals' (legacy) and 'manager-goals-approval' (new) type values
      // Follows the same pattern as manager-evaluations
      if (role === 'manager' && (type === 'goals' || type === 'manager-goals-approval')) {
        if (isYearEnd) {
          // For year-end, use Q4's goal submission end date
          const gqcResult = await query(
            `SELECT goal_submission_end_date 
             FROM goals_quarterly_cycles 
             WHERE performance_cycle_id = $1 AND quarter = 4`,
            [cycle_id]
          );
          
          if (gqcResult.rows.length === 0) {
            return res.status(404).json({ error: 'Goal cycle not found for year-end' });
          }
          
          const goalEndDate = gqcResult.rows[0].goal_submission_end_date;
          
          if (!goalEndDate) {
            return res.status(400).json({ error: 'Goal submission end date is not configured for year-end' });
          }
          
          // Check if deadline has passed - only show data after deadline
          const now = new Date();
          now.setHours(0, 0, 0, 0);
          const endDate = new Date(goalEndDate);
          endDate.setHours(23, 59, 59, 999);
          
          if (now <= endDate) {
            // Deadline hasn't passed - return empty data
            return res.json({ data: [] });
          }
        } else {
          // For quarterly periods, get goal submission end date
          const gqcResult = await query(
            `SELECT goal_submission_end_date 
             FROM goals_quarterly_cycles 
             WHERE performance_cycle_id = $1 AND quarter = $2`,
            [cycle_id, quarterNum]
          );
          
          if (gqcResult.rows.length === 0) {
            return res.status(404).json({ error: 'Goal cycle not found for this quarter' });
          }
          
          const goalEndDate = gqcResult.rows[0].goal_submission_end_date;
          
          if (!goalEndDate) {
            return res.status(400).json({ error: 'Goal submission end date is not configured for this quarter' });
          }
          
          // Check if deadline has passed - only show data after deadline
          const now = new Date();
          now.setHours(0, 0, 0, 0);
          const endDate = new Date(goalEndDate);
          endDate.setHours(23, 59, 59, 999);
          
          if (now <= endDate) {
            // Deadline hasn't passed - return empty data
            return res.json({ data: [] });
          }
        }
        
        // Get all managers from profiles table (role = 'manager' or 'hr_admin')
        // Join with employees to get active managers only
        const managersResult = await query(
          `SELECT DISTINCT e.id, e.emp_code, e.full_name, e.email, e.department, e.date_of_joining
           FROM profiles p
           INNER JOIN employees e ON e.profile_id = p.id
           WHERE p.role IN ('manager', 'hr_admin')
           AND e.status = 'active'
           ORDER BY e.full_name`,
          []
        );
        
        // Get all reportees for each manager
        let reporteesSql = `SELECT e.id as reportee_id, e.emp_code as reportee_emp_code, e.full_name as reportee_name,
                  e.date_of_joining as reportee_date_of_joining, e.manager_code,
                  m.id as manager_id, m.emp_code as manager_emp_code, m.full_name as manager_name
           FROM employees e
           INNER JOIN employees m ON m.emp_code = e.manager_code
           WHERE e.status = 'active' AND m.status = 'active'
           ORDER BY m.full_name, e.full_name`;
        const reporteesResult = await query(reporteesSql, []);
        
        // Get all goals/KRAs that are still in 'submitted' status (pending approval)
        // For year-end, check goals/KRAs with NULL quarter or quarter = 4
        // Use CTE to avoid parameter reuse issues
        let pendingGoalsResult;
        if (isYearEnd) {
          pendingGoalsResult = await query(
            `WITH params AS (
              SELECT $1::uuid as cycle_id
            )
            SELECT employee_id, 
               COUNT(*) FILTER (WHERE table_type = 'kra') as pending_kras,
               COUNT(*) FILTER (WHERE table_type = 'goal') as pending_goals
             FROM (
               SELECT k.employee_id, 'kra' as table_type
               FROM kras k
               CROSS JOIN params p
               WHERE k.cycle_id = p.cycle_id AND (k.quarter IS NULL OR k.quarter = 4) AND k.status = 'submitted'
               UNION ALL
               SELECT g.employee_id, 'goal' as table_type
               FROM goals g
               CROSS JOIN params p
               WHERE g.cycle_id = p.cycle_id AND (g.quarter IS NULL OR g.quarter = 4) AND g.status = 'submitted'
             ) combined
             GROUP BY employee_id`,
            [cycle_id]
          );
        } else {
          pendingGoalsResult = await query(
            `WITH params AS (
              SELECT $1::uuid as cycle_id, $2::integer as quarter
            )
            SELECT employee_id, 
               COUNT(*) FILTER (WHERE table_type = 'kra') as pending_kras,
               COUNT(*) FILTER (WHERE table_type = 'goal') as pending_goals
             FROM (
               SELECT k.employee_id, 'kra' as table_type
               FROM kras k
               CROSS JOIN params p
               WHERE k.cycle_id = p.cycle_id AND k.quarter = p.quarter AND k.status = 'submitted'
               UNION ALL
               SELECT g.employee_id, 'goal' as table_type
               FROM goals g
               CROSS JOIN params p
               WHERE g.cycle_id = p.cycle_id AND g.quarter = p.quarter AND g.status = 'submitted'
             ) combined
             GROUP BY employee_id`,
            [cycle_id, quarterNum]
          );
        }
        
        // Create a map of employees with pending goals/KRAs
        const employeesWithPendingGoals = new Map();
        pendingGoalsResult.rows.forEach(r => {
          const pendingCount = parseInt(r.pending_kras || 0) + parseInt(r.pending_goals || 0);
          employeesWithPendingGoals.set(r.employee_id, pendingCount);
        });
        
        // Group reportees by manager
        const reporteesByManager = new Map();
        reporteesResult.rows.forEach(r => {
          const managerId = r.manager_id;
          if (!reporteesByManager.has(managerId)) {
            reporteesByManager.set(managerId, {
              manager_id: managerId,
              manager_emp_code: r.manager_emp_code,
              manager_name: r.manager_name,
              reportees: []
            });
          }
          reporteesByManager.get(managerId).reportees.push({
            employee_id: r.reportee_id,
            emp_code: r.reportee_emp_code,
            employee_name: r.reportee_name,
            date_of_joining: r.reportee_date_of_joining
          });
        });
        
        // Get existing late submission permissions for managers
        // Filter by type and role to ensure permissions are scoped correctly
        let permissionsResult;
        if (isYearEnd) {
          permissionsResult = await query(
            `SELECT * FROM late_submission_permissions 
             WHERE cycle_id = $1 AND quarter IS NULL
               AND COALESCE(type, 'goals') = $2 
               AND COALESCE(role, 'employee') = $3 
               AND revoked_at IS NULL`,
            [cycle_id, 'manager-goals-approval', 'manager']
          );
        } else {
          permissionsResult = await query(
            `SELECT * FROM late_submission_permissions 
             WHERE cycle_id = $1 AND (quarter = $2 OR quarter IS NULL) 
               AND COALESCE(type, 'goals') = $3 
               AND COALESCE(role, 'employee') = $4 
               AND revoked_at IS NULL`,
            [cycle_id, quarterNum, 'manager-goals-approval', 'manager']
          );
        }
        const permissionsMap = new Map();
        permissionsResult.rows.forEach(p => {
          const existingPerm = permissionsMap.get(p.employee_id);
          if (!existingPerm || (p.quarter !== null && existingPerm.quarter === null)) {
            permissionsMap.set(p.employee_id, p);
          }
        });
        
        // Build response: managers with pending reportee goal approvals
        const response = [];
        
        for (const manager of managersResult.rows) {
          const managerData = reporteesByManager.get(manager.id);
          if (!managerData || managerData.reportees.length === 0) {
            continue; // Skip managers with no reportees
          }
          
          // Check which reportees have pending goal approvals
          const pendingEmployees = [];
          let allApproved = true;
          
          for (const reportee of managerData.reportees) {
            const pendingCount = employeesWithPendingGoals.get(reportee.employee_id) || 0;
            if (pendingCount > 0) {
              allApproved = false;
              pendingEmployees.push({
                employee_id: reportee.employee_id,
                emp_code: reportee.emp_code,
                employee_name: reportee.employee_name,
                pending_goals_count: pendingCount
              });
            }
          }
          
          // Include manager if they have pending employees OR have permission
          const hasPermission = permissionsMap.has(manager.id);
          if (!allApproved || hasPermission) {
            if (!employee_id || manager.id === employee_id) {
              response.push({
                employee_id: manager.id,
                emp_code: manager.emp_code,
                employee_name: manager.full_name,
                employee_email: manager.email,
                department: manager.department,
                date_of_joining: manager.date_of_joining,
                manager_code: null,
                manager_id: null,
                manager_emp_code: null,
                manager_name: null,
                has_submitted: allApproved, // Manager has "submitted" if all reportees' goals are approved
                permission: hasPermission ? permissionsMap.get(manager.id) : null,
                needs_permission: !allApproved && !hasPermission,
                pending_employees: pendingEmployees
              });
            }
          }
        }
        
        return res.json({ data: response });
      }
      
      // ========== MANAGER EVALUATIONS LOGIC ==========
      if (type === 'manager-evaluations') {
        if (isYearEnd) {
          return res.status(400).json({ error: 'Manager evaluations are only supported for quarterly periods, not year-end' });
        }
        
        // Get manager review end date to check eligibility
        const qcResult = await query(
          `SELECT manager_review_start_date, manager_review_end_date 
           FROM quarterly_cycles 
           WHERE performance_cycle_id = $1 AND quarter = $2`,
          [cycle_id, quarterNum]
        );
        
        if (qcResult.rows.length === 0) {
          return res.status(404).json({ error: 'Quarterly cycle not found for this quarter' });
        }
        
        const managerReviewEndDate = qcResult.rows[0].manager_review_end_date;
        const managerReviewStartDate = qcResult.rows[0].manager_review_start_date;
        
        if (!managerReviewEndDate) {
          return res.status(400).json({ error: 'Manager review end date is not configured for this quarter' });
        }
        
        // Check eligibility: only show data when manager review window has ended
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const endDate = new Date(managerReviewEndDate);
        endDate.setHours(23, 59, 59, 999);
        
        if (now <= endDate) {
          // Manager review window hasn't ended yet - return empty data
          return res.json({ data: [] });
        }
        
        // Get all managers from profiles table (role = 'manager' or 'hr_admin') for this quarter
        // Join with employees to get active managers only
        let managersSql = `SELECT DISTINCT e.id, e.emp_code, e.full_name, e.email, e.department, e.date_of_joining
           FROM profiles p
           INNER JOIN employees e ON e.profile_id = p.id
           WHERE p.role IN ('manager', 'hr_admin')
           AND e.status = 'active'`;
        let managersParams = [];
        if (managerReviewStartDate) {
          managersSql += ` AND e.date_of_joining <= $1`;
          managersParams.push(managerReviewStartDate);
        }
        managersSql += ` ORDER BY e.full_name`;
        const managersResult = await query(managersSql, managersParams);
        
        // Get all reportees for each manager
        let reporteesSql = `SELECT e.id as reportee_id, e.emp_code as reportee_emp_code, e.full_name as reportee_name,
                  e.date_of_joining as reportee_date_of_joining, e.manager_code,
                  m.id as manager_id, m.emp_code as manager_emp_code, m.full_name as manager_name
           FROM employees e
           INNER JOIN employees m ON m.emp_code = e.manager_code
           WHERE e.status = 'active' AND m.status = 'active'`;
        let reporteesParams = [];
        if (managerReviewStartDate) {
          reporteesSql += ` AND e.date_of_joining <= $1`;
          reporteesParams.push(managerReviewStartDate);
        }
        reporteesSql += ` ORDER BY m.full_name, e.full_name`;
        const reporteesResult = await query(reporteesSql, reporteesParams);
        
        // Get completed manager reviews for this quarter
        // A review is considered completed if status is 'submitted', 'calibrated', or 'released'
        const completedReviewsResult = await query(
          `SELECT employee_id, reviewer_id
           FROM quarterly_manager_reviews
           WHERE cycle_id = $1 AND quarter = $2 
           AND status IN ('submitted', 'calibrated', 'released')`,
          [cycle_id, quarterNum]
        );
        
        // Create a set of completed reviews: employee_id -> reviewer_id
        const completedReviews = new Set();
        completedReviewsResult.rows.forEach(r => {
          completedReviews.add(`${r.employee_id}_${r.reviewer_id}`);
        });
        
        // Group reportees by manager
        const reporteesByManager = new Map();
        reporteesResult.rows.forEach(r => {
          const managerId = r.manager_id;
          if (!reporteesByManager.has(managerId)) {
            reporteesByManager.set(managerId, {
              manager_id: managerId,
              manager_emp_code: r.manager_emp_code,
              manager_name: r.manager_name,
              reportees: []
            });
          }
          reporteesByManager.get(managerId).reportees.push({
            employee_id: r.reportee_id,
            emp_code: r.reportee_emp_code,
            employee_name: r.reportee_name,
            date_of_joining: r.reportee_date_of_joining
          });
        });
        
        // Get existing late submission permissions for managers
        // Filter by type and role to ensure permissions are scoped correctly
        const permissionsResult = await query(
          `SELECT * FROM late_submission_permissions 
           WHERE cycle_id = $1 AND (quarter = $2 OR quarter IS NULL) 
             AND COALESCE(type, 'goals') = $3 
             AND COALESCE(role, 'employee') = $4 
             AND revoked_at IS NULL`,
          [cycle_id, quarterNum, 'manager-evaluations', 'manager']
        );
        const permissionsMap = new Map();
        permissionsResult.rows.forEach(p => {
          const existingPerm = permissionsMap.get(p.employee_id);
          if (!existingPerm || (p.quarter !== null && existingPerm.quarter === null)) {
            permissionsMap.set(p.employee_id, p);
          }
        });
        
        // Build response: managers with pending reportee reviews
        const response = [];
        
        for (const manager of managersResult.rows) {
          const managerData = reporteesByManager.get(manager.id);
          if (!managerData || managerData.reportees.length === 0) {
            continue; // Skip managers with no reportees
          }
          
          // Check if all reportees have completed manager reviews
          const pendingReportees = [];
          let allCompleted = true;
          
          for (const reportee of managerData.reportees) {
            const reviewKey = `${reportee.employee_id}_${manager.id}`;
            if (!completedReviews.has(reviewKey)) {
              allCompleted = false;
              pendingReportees.push(reportee);
            }
          }
          
          // Include manager if they have pending reportees OR have permission
          const hasPermission = permissionsMap.has(manager.id);
          if (!allCompleted || hasPermission) {
            if (!employee_id || manager.id === employee_id) {
              response.push({
                employee_id: manager.id,
                emp_code: manager.emp_code,
                employee_name: manager.full_name,
                employee_email: manager.email,
                department: manager.department,
                date_of_joining: manager.date_of_joining,
                manager_code: null,
                manager_id: null,
                manager_emp_code: null,
                manager_name: null,
                has_submitted: allCompleted,
                permission: hasPermission ? permissionsMap.get(manager.id) : null,
                needs_permission: !allCompleted && !hasPermission,
                pending_reportees: pendingReportees
              });
            }
          }
        }
        
        return res.json({ data: response });
      }
      
      // ========== EXISTING GOALS/EVALUATIONS LOGIC ==========
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
      // For goals: check goals table where status IN ('submitted', 'approved')
      // For evaluations: check quarterly_self_reviews or self_evaluations table
      // For manager-evaluations: handled separately above
      let submittedResult;
      if (type === 'goals') {
        // For goals, check if employee has any goals with status 'submitted' or 'approved'
        if (isYearEnd) {
          // Year-end goals don't have quarter, but we still need to check goals table
          // Note: Goals are typically quarter-based, so year-end might not apply
          submittedResult = await query(
            `SELECT DISTINCT employee_id 
             FROM goals 
             WHERE cycle_id = $1 AND status IN ('submitted', 'approved')`,
            [cycle_id]
          );
        } else {
          submittedResult = await query(
            `SELECT DISTINCT employee_id 
             FROM goals 
             WHERE cycle_id = $1 AND quarter = $2 AND status IN ('submitted', 'approved')`,
            [cycle_id, quarterNum]
          );
        }
      } else if (type === 'evaluations') {
        // For evaluations: check quarterly_self_reviews or self_evaluations table
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
      } else {
        // For manager-evaluations, this should not reach here (handled above)
        submittedResult = { rows: [] };
      }
      const submittedEmployeeIds = new Set(submittedResult.rows.map(r => r.employee_id));
      
      // Get existing late submission permissions for this cycle AND quarter
      // For year-end, check for NULL quarter (year-end permissions are stored with NULL)
      // For quarters, check for specific quarter or NULL (applies to all quarters)
      // Filter by type and role to ensure permissions are scoped correctly
      const permissionType = type || 'goals';
      const permissionRole = role || 'employee';
      
      let permissionsSql, permissionsParams;
      if (isYearEnd) {
        // For year-end, check for quarter IS NULL
        permissionsSql = `SELECT * FROM late_submission_permissions 
                         WHERE cycle_id = $1 AND quarter IS NULL 
                           AND COALESCE(type, 'goals') = $2 
                           AND COALESCE(role, 'employee') = $3`;
        permissionsParams = [cycle_id, permissionType, permissionRole];
      } else {
        permissionsSql = `SELECT * FROM late_submission_permissions 
                         WHERE cycle_id = $1 AND (quarter = $2 OR quarter IS NULL)
                           AND COALESCE(type, 'goals') = $3 
                           AND COALESCE(role, 'employee') = $4`;
        permissionsParams = [cycle_id, quarterNum, permissionType, permissionRole];
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
    const { employee_id, cycle_id, expires_at, reason, granted_by, quarter, type, role } = req.body;
    
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
    
    // Default type and role if not provided (for backward compatibility)
    const permissionType = type || 'goals';
    const permissionRole = role || 'employee';
    
    // Validate type and role
    const validTypes = ['goals', 'evaluations', 'manager-goals-approval', 'manager-evaluations'];
    const validRoles = ['employee', 'manager'];
    if (!validTypes.includes(permissionType)) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
    }
    if (!validRoles.includes(permissionRole)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
    }
    
    // Check if permission already exists for this employee, cycle, quarter, type, and role
    let existingCheck;
    if (isYearEnd) {
      existingCheck = await query(
        `SELECT id, revoked_at FROM late_submission_permissions 
         WHERE employee_id = $1 AND cycle_id = $2 AND quarter IS NULL 
           AND COALESCE(type, 'goals') = $3 AND COALESCE(role, 'employee') = $4`,
        [employee_id, cycle_id, permissionType, permissionRole]
      );
    } else {
      existingCheck = await query(
        `SELECT id, revoked_at FROM late_submission_permissions 
         WHERE employee_id = $1 AND cycle_id = $2 AND COALESCE(quarter, 0) = $3
           AND COALESCE(type, 'goals') = $4 AND COALESCE(role, 'employee') = $5`,
        [employee_id, cycle_id, quarterNum ?? 0, permissionType, permissionRole]
      );
    }
    
    if (existingCheck.rows.length > 0) {
      const existing = existingCheck.rows[0];
      
      // If permission exists and is not revoked, return error
      if (!existing.revoked_at) {
        return res.status(409).json({ 
          error: `Late submission permission already exists for this employee${isYearEnd ? ' for year-end evaluation' : (quarterNum ? ` for Q${quarterNum}` : ' for all quarters')} with type ${permissionType} and role ${permissionRole}` 
        });
      }
      
      // If permission exists but was revoked, update it instead of creating new
      const result = await query(
        `UPDATE late_submission_permissions 
         SET granted_by = $1, expires_at = $2, reason = $3, revoked_at = NULL, granted_at = NOW(), 
             quarter = $4, type = $5, role = $6
         WHERE id = $7
         RETURNING *`,
        [granted_by || req.user.userId, expires_at || null, reason || null, quarterNum, permissionType, permissionRole, existing.id]
      );
      
      return res.status(200).json({ data: result.rows[0] });
    }
    
    // Create new permission
    const result = await query(
      `INSERT INTO late_submission_permissions 
       (employee_id, cycle_id, granted_by, expires_at, reason, quarter, type, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [employee_id, cycle_id, granted_by || req.user.userId, expires_at || null, reason || null, quarterNum, permissionType, permissionRole]
    );
    
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    console.error('Create late submission permission error:', error);
    
    // Handle unique constraint violation
    if (error.code === '23505') { // PostgreSQL unique violation
      return res.status(409).json({ 
        error: 'Late submission permission already exists for this employee, quarter, type, and role' 
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

// GET /api/permissions/late-submission-details - Get late submission statistics (Unified for Goals + Evaluations + Manager Evaluations)
// Accepts optional 'type' parameter: 'goals' | 'evaluations' | 'manager-evaluations' to determine which dates to check for quarter accessibility
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
    
    // ========== MANAGER GOALS APPROVAL LOGIC ==========
    if (type === 'manager-goals-approval') {
      // Get goal submission end date (to determine if deadline has passed)
      // For year-end, use Q4's goal submission end date
      let gqcResult;
      if (isYearEnd) {
        gqcResult = await query(
          `SELECT goal_submission_end_date 
           FROM goals_quarterly_cycles 
           WHERE performance_cycle_id = $1 AND quarter = 4`,
          [cycle_id]
        );
      } else {
        gqcResult = await query(
          `SELECT goal_submission_end_date 
           FROM goals_quarterly_cycles 
           WHERE performance_cycle_id = $1 AND quarter = $2`,
          [cycle_id, quarterNum]
        );
      }
      
      if (gqcResult.rows.length === 0) {
        return res.status(404).json({ error: isYearEnd ? 'Goals quarterly cycle not found for Q4 (year-end)' : 'Goals quarterly cycle not found for this quarter' });
      }
      
      const goalEndDate = gqcResult.rows[0].goal_submission_end_date;
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      
      // For manager goals approval, only show data after the deadline has passed
      let isPastDeadline = false;
      if (goalEndDate) {
        const endDate = new Date(goalEndDate);
        endDate.setHours(23, 59, 59, 999);
        isPastDeadline = now > endDate;
      } else {
        // If no deadline is set, don't show data
        isPastDeadline = false;
      }
      
      // Calculate counts regardless of deadline
      // But only count submitted/missedDeadline after deadline passes
      const hasStarted = true; // Always true for manager approvals
      
      // Get all managers from profiles table (role = 'manager' or 'hr_admin')
      // Join with employees to get active managers only
      const managersResult = await query(
        `SELECT DISTINCT e.id
         FROM profiles p
         INNER JOIN employees e ON e.profile_id = p.id
         WHERE p.role IN ('manager', 'hr_admin')
         AND e.status = 'active'`,
        []
      );
      
      // Get all reportees grouped by manager
      const reporteesResult = await query(
        `SELECT e.id as reportee_id, m.id as manager_id
         FROM employees e
         INNER JOIN employees m ON m.emp_code = e.manager_code
         WHERE e.status = 'active' AND m.status = 'active'`,
        []
      );
      
      // Group reportees by manager
      const reporteesByManager = new Map();
      reporteesResult.rows.forEach(r => {
        if (!reporteesByManager.has(r.manager_id)) {
          reporteesByManager.set(r.manager_id, []);
        }
        reporteesByManager.get(r.manager_id).push(r.reportee_id);
      });
      
      // Get ALL goals/KRAs for this quarter/year-end (any status)
      // We need to check all statuses to properly categorize managers
      // For year-end, goals/KRAs might have NULL quarter or we check Q4
      let allGoalsResult;
      let allKRAsResult;
      
      if (isYearEnd) {
        // For year-end, check goals/KRAs with NULL quarter or quarter = 4
        allGoalsResult = await query(
          `SELECT g.employee_id, g.status
           FROM goals g
           WHERE g.cycle_id = $1 AND (g.quarter IS NULL OR g.quarter = 4)`,
          [cycle_id]
        );
        
        allKRAsResult = await query(
          `SELECT k.employee_id, k.status
           FROM kras k
           WHERE k.cycle_id = $1 AND (k.quarter IS NULL OR k.quarter = 4)`,
          [cycle_id]
        );
      } else {
        allGoalsResult = await query(
          `SELECT g.employee_id, g.status
           FROM goals g
           WHERE g.cycle_id = $1 AND g.quarter = $2`,
          [cycle_id, quarterNum]
        );
        
        allKRAsResult = await query(
          `SELECT k.employee_id, k.status
           FROM kras k
           WHERE k.cycle_id = $1 AND k.quarter = $2`,
          [cycle_id, quarterNum]
        );
      }
      
      // Group goals/KRAs by employee_id
      // For each employee, track: hasGoals (any goals/KRAs), allApproved (all are 'approved')
      const employeeGoalsStatus = new Map(); // employee_id -> { hasGoals: boolean, allApproved: boolean }
      
      // Initialize all reportees
      reporteesResult.rows.forEach(r => {
        if (!employeeGoalsStatus.has(r.reportee_id)) {
          employeeGoalsStatus.set(r.reportee_id, { hasGoals: false, allApproved: true });
        }
      });
      
      // Process goals
      allGoalsResult.rows.forEach(g => {
        if (!employeeGoalsStatus.has(g.employee_id)) {
          employeeGoalsStatus.set(g.employee_id, { hasGoals: false, allApproved: true });
        }
        const status = employeeGoalsStatus.get(g.employee_id);
        status.hasGoals = true;
        // If any goal is not 'approved', then not all approved
        if (g.status !== 'approved') {
          status.allApproved = false;
        }
      });
      
      // Process KRAs
      allKRAsResult.rows.forEach(k => {
        if (!employeeGoalsStatus.has(k.employee_id)) {
          employeeGoalsStatus.set(k.employee_id, { hasGoals: false, allApproved: true });
        }
        const status = employeeGoalsStatus.get(k.employee_id);
        status.hasGoals = true;
        // If any KRA is not 'approved', then not all approved
        if (k.status !== 'approved') {
          status.allApproved = false;
        }
      });
      
      // Count managers who have reportees with goals/KRAs
      // Only count managers who have at least one reportee with goals/KRAs
      let submittedManagers = 0;
      let missedDeadlineManagers = 0;
      let managersWithReporteesHavingGoals = 0;
      
      for (const manager of managersResult.rows) {
        const reportees = reporteesByManager.get(manager.id) || [];
        if (reportees.length === 0) continue;
        
        // Check if this manager has any reportees with goals/KRAs
        let hasReporteesWithGoals = false;
        let allReporteesApproved = true;
        
        for (const reporteeId of reportees) {
          const reporteeStatus = employeeGoalsStatus.get(reporteeId);
          if (reporteeStatus && reporteeStatus.hasGoals) {
            hasReporteesWithGoals = true;
            // If any reportee doesn't have all goals/KRAs approved, then manager hasn't completed approval
            if (!reporteeStatus.allApproved) {
              allReporteesApproved = false;
            }
          }
        }
        
        // Only count managers who have reportees with goals/KRAs
        if (hasReporteesWithGoals) {
          managersWithReporteesHavingGoals++;
          
          // Only count submitted/missedDeadline if deadline has passed
          // Before deadline, all counts are 0 but totalManagers is still calculated
          if (isPastDeadline) {
            if (allReporteesApproved) {
              // All reportees with goals/KRAs have them all approved
              submittedManagers++;
            } else {
              // Has at least one reportee with unapproved goals/KRAs and deadline has passed
              missedDeadlineManagers++;
            }
          }
          // Note: If deadline hasn't passed, managers are "in progress"
          // They're counted in totalManagers but not in submitted/missedDeadline
          // submitted and missedDeadline will be 0 until deadline passes
        }
      }
      
      // Update totalManagers to only include managers with reportees who have goals/KRAs
      // Ensure: totalManagers = submittedManagers + missedDeadlineManagers
      // If deadline has passed, all managers with reportees having goals should be in submitted or missedDeadline
      // If deadline hasn't passed, managers with pending are "in progress" and not counted in missedDeadline yet
      const totalManagers = managersWithReporteesHavingGoals;
      
      // Debug: Verify the math
      // If deadline has passed, totalManagers should equal submitted + missedDeadline
      // If deadline hasn't passed, totalManagers >= submitted + missedDeadline (some are in progress)
      const calculatedTotal = submittedManagers + missedDeadlineManagers;
      if (isPastDeadline && calculatedTotal !== totalManagers) {
        console.warn(`Manager goals approval stats mismatch: totalManagers=${totalManagers}, submitted=${submittedManagers}, missedDeadline=${missedDeadlineManagers}`);
      }
      
      // Get late access granted count for managers
      let lateAccessResult;
      if (isYearEnd) {
        lateAccessResult = await query(
          `SELECT COUNT(DISTINCT lsp.employee_id) as count
           FROM late_submission_permissions lsp
           INNER JOIN employees m ON m.id = lsp.employee_id
           WHERE lsp.cycle_id = $1 
           AND lsp.quarter IS NULL
           AND COALESCE(lsp.type, 'goals') = $2
           AND COALESCE(lsp.role, 'employee') = $3
           AND lsp.revoked_at IS NULL
           AND EXISTS (
             SELECT 1 FROM employees e 
             WHERE e.manager_code = m.emp_code 
             AND e.status = 'active'
           )`,
          [cycle_id, 'manager-goals-approval', 'manager']
        );
      } else {
        lateAccessResult = await query(
          `SELECT COUNT(DISTINCT lsp.employee_id) as count
           FROM late_submission_permissions lsp
           INNER JOIN employees m ON m.id = lsp.employee_id
           WHERE lsp.cycle_id = $1 
           AND (lsp.quarter = $2 OR lsp.quarter IS NULL)
           AND COALESCE(lsp.type, 'goals') = $3
           AND COALESCE(lsp.role, 'employee') = $4
           AND lsp.revoked_at IS NULL
           AND EXISTS (
             SELECT 1 FROM employees e 
             WHERE e.manager_code = m.emp_code 
             AND e.status = 'active'
           )`,
          [cycle_id, quarterNum, 'manager-goals-approval', 'manager']
        );
      }
      const lateAccessGranted = parseInt(lateAccessResult.rows[0]?.count || 0);
      
      // Get total managers in the organization from profiles table (role = 'manager' or 'hr_admin')
      // Join with employees to get active managers only
      const allManagersResult = await query(
        `SELECT COUNT(DISTINCT e.id) as count
         FROM profiles p
         INNER JOIN employees e ON e.profile_id = p.id
         WHERE p.role IN ('manager', 'hr_admin')
         AND e.status = 'active'`,
        []
      );
      const totalManagersInOrg = parseInt(allManagersResult.rows[0]?.count || 0);
      
      return res.json({
        data: {
          totalEmployees: totalManagersInOrg, 
          totalManagers: totalManagers, 
          managerGoalsApproval: {
            submitted: submittedManagers,
            missedDeadline: missedDeadlineManagers,
            lateAccessGranted: lateAccessGranted,
            quarter: isYearEnd ? null : quarterNum,
            isPastDeadline: isPastDeadline,
            hasStarted: hasStarted,
            startDate: goalEndDate || null, // Use goal end date as reference
          }
        }
      });
    }
    
    // ========== MANAGER EVALUATIONS LOGIC ==========
    if (type === 'manager-evaluations') {
      if (isYearEnd) {
        return res.status(400).json({ error: 'Manager evaluations are only supported for quarterly periods, not year-end' });
      }
      
      // Get manager review dates
      const qcResult = await query(
        `SELECT manager_review_start_date, manager_review_end_date 
         FROM quarterly_cycles 
         WHERE performance_cycle_id = $1 AND quarter = $2`,
        [cycle_id, quarterNum]
      );
      
      if (qcResult.rows.length === 0) {
        return res.status(404).json({ error: 'Quarterly cycle not found for this quarter' });
      }
      
      const managerReviewStartDate = qcResult.rows[0].manager_review_start_date;
      const managerReviewEndDate = qcResult.rows[0].manager_review_end_date;
      
      if (!managerReviewEndDate) {
        return res.status(400).json({ error: 'Manager review end date is not configured for this quarter' });
      }
      
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const endDate = new Date(managerReviewEndDate);
      endDate.setHours(23, 59, 59, 999);
      
      const isPastDeadline = now > endDate;
      const hasStarted = managerReviewStartDate ? (now >= new Date(managerReviewStartDate)) : false;
      
      // Get all managers from profiles table (role = 'manager' or 'hr_admin')
      // Join with employees to get active managers only
      let managersSql = `SELECT DISTINCT e.id
         FROM profiles p
         INNER JOIN employees e ON e.profile_id = p.id
         WHERE p.role IN ('manager', 'hr_admin')
         AND e.status = 'active'`;
      let managersParams = [];
      if (managerReviewStartDate) {
        managersSql += ` AND e.date_of_joining <= $1`;
        managersParams.push(managerReviewStartDate);
      }
      const managersResult = await query(managersSql, managersParams);
      
      const totalManagers = managersResult.rows.length;
      
      // Get all reportees grouped by manager
      let reporteesSql = `SELECT e.id as reportee_id, m.id as manager_id
         FROM employees e
         INNER JOIN employees m ON m.emp_code = e.manager_code
         WHERE e.status = 'active' AND m.status = 'active'`;
      let reporteesParams = [];
      if (managerReviewStartDate) {
        reporteesSql += ` AND e.date_of_joining <= $1`;
        reporteesParams.push(managerReviewStartDate);
      }
      const reporteesResult = await query(reporteesSql, reporteesParams);
      
      // Group reportees by manager
      const reporteesByManager = new Map();
      reporteesResult.rows.forEach(r => {
        if (!reporteesByManager.has(r.manager_id)) {
          reporteesByManager.set(r.manager_id, []);
        }
        reporteesByManager.get(r.manager_id).push(r.reportee_id);
      });
      
      // Get completed manager reviews
      // A review is considered completed if status is 'submitted', 'calibrated', or 'released'
      const completedReviewsResult = await query(
        `SELECT employee_id, reviewer_id
         FROM quarterly_manager_reviews
         WHERE cycle_id = $1 AND quarter = $2 
         AND status IN ('submitted', 'calibrated', 'released')`,
        [cycle_id, quarterNum]
      );
      
      // Create a set of completed reviews: employee_id -> reviewer_id
      const completedReviews = new Set();
      completedReviewsResult.rows.forEach(r => {
        completedReviews.add(`${r.employee_id}_${r.reviewer_id}`);
      });
      
      // Count managers who have completed all reportee reviews
      let submittedManagers = 0;
      let missedDeadlineManagers = 0;
      
      for (const manager of managersResult.rows) {
        const reportees = reporteesByManager.get(manager.id) || [];
        if (reportees.length === 0) continue;
        
        let allCompleted = true;
        for (const reporteeId of reportees) {
          const reviewKey = `${reporteeId}_${manager.id}`;
          if (!completedReviews.has(reviewKey)) {
            allCompleted = false;
            break;
          }
        }
        
        if (allCompleted) {
          submittedManagers++;
        } else if (isPastDeadline) {
          missedDeadlineManagers++;
        }
      }
      
      // Get late access granted count for managers
      const lateAccessResult = await query(
        `SELECT COUNT(DISTINCT lsp.employee_id) as count
         FROM late_submission_permissions lsp
         INNER JOIN employees m ON m.id = lsp.employee_id
         WHERE lsp.cycle_id = $1 
         AND (lsp.quarter = $2 OR lsp.quarter IS NULL)
         AND lsp.revoked_at IS NULL
         AND EXISTS (
           SELECT 1 FROM employees e 
           WHERE e.manager_code = m.emp_code 
           AND e.status = 'active'
         )`,
        [cycle_id, quarterNum]
      );
      const lateAccessGranted = parseInt(lateAccessResult.rows[0]?.count || 0);
      
      return res.json({
        data: {
          totalManagers: hasStarted ? totalManagers : 0,
          managerEvaluations: {
            submitted: hasStarted ? submittedManagers : 0,
            missedDeadline: hasStarted ? missedDeadlineManagers : 0,
            lateAccessGranted: hasStarted ? lateAccessGranted : 0,
            quarter: quarterNum,
            isPastDeadline: isPastDeadline,
            hasStarted: hasStarted,
            startDate: managerReviewStartDate || null,
          }
        }
      });
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

// GET /api/permissions/employee-quarterly-status - Get employee status across all quarters by emp_code
router.get('/employee-quarterly-status', authMiddleware, requireRole(['hr_admin', 'system_admin']), async (req, res) => {
  try {
    const { emp_code, cycle_id } = req.query;
    
    if (!emp_code || !cycle_id) {
      return res.status(400).json({ error: 'emp_code and cycle_id are required' });
    }
    
    const employeeResult = await query(
      `SELECT id, emp_code, full_name, email, department 
       FROM employees 
       WHERE LOWER(emp_code) = LOWER($1) AND status = 'active'`,
      [emp_code]
    );
    
    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    const employee = employeeResult.rows[0];
    const employeeId = employee.id;
    
    const quarterlyCyclesResult = await query(
      `SELECT quarter, quarter_start_date, quarter_end_date
       FROM quarterly_cycles
       WHERE performance_cycle_id = $1
       ORDER BY quarter`,
      [cycle_id]
    );
    

    const employeeQuartersResult = await query(
      `WITH params AS (
         SELECT $1::uuid as emp_id, $2::uuid as cyc_id
       )
       SELECT DISTINCT quarter
       FROM (
         SELECT quarter FROM kras k, params p WHERE k.employee_id = p.emp_id AND k.cycle_id = p.cyc_id AND k.quarter IS NOT NULL
         UNION
         SELECT quarter FROM goals g, params p WHERE g.employee_id = p.emp_id AND g.cycle_id = p.cyc_id AND g.quarter IS NOT NULL
         UNION
         SELECT quarter FROM quarterly_self_reviews qsr, params p WHERE qsr.employee_id = p.emp_id AND qsr.cycle_id = p.cyc_id AND qsr.quarter IS NOT NULL
         UNION
         SELECT quarter FROM quarterly_manager_reviews qmr, params p WHERE qmr.employee_id = p.emp_id AND qmr.cycle_id = p.cyc_id AND qmr.quarter IS NOT NULL
       ) AS employee_quarters
       ORDER BY quarter`,
      [employeeId, cycle_id]
    );
    
    const employeeQuarters = new Set(employeeQuartersResult.rows.map(r => r.quarter));
    
  
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let currentQuarter = null;
    
    for (const qc of quarterlyCyclesResult.rows) {
      if (qc.quarter_start_date && qc.quarter_end_date) {
        const qStart = new Date(qc.quarter_start_date);
        const qEnd = new Date(qc.quarter_end_date);
        qStart.setHours(0, 0, 0, 0);
        qEnd.setHours(23, 59, 59, 999);
        if (today >= qStart && today <= qEnd) {
          currentQuarter = qc.quarter;
          break;
        }
      }
    }
    
    
    const quartersFromCycles = quarterlyCyclesResult.rows
      .filter(qc => {
        // If quarter has a start date, check if it has started
        if (qc.quarter_start_date) {
          const qStart = new Date(qc.quarter_start_date);
          qStart.setHours(0, 0, 0, 0);
          // Include if start date is today or in the past (quarter has started)
          return today >= qStart;
        }
        // If no start date, include it
        return true;
      })
      .map(qc => qc.quarter);
    

    const quartersToInclude = Array.from(new Set([...quartersFromCycles, ...Array.from(employeeQuarters)]))
      .filter(q => q >= 1 && q <= 4) // Ensure valid quarter range
      .sort((a, b) => a - b);
    
    if (quartersToInclude.length === 0) {
      return res.json({
        data: {
          employee: {
            id: employee.id,
            emp_code: employee.emp_code,
            full_name: employee.full_name,
            email: employee.email,
            department: employee.department
          },
          quarters: []
        }
      });
    }
    
     
      const quartersPlaceholder = quartersToInclude.join(',');
      const goalsResult = await query(
        `WITH params AS (
         SELECT $1::uuid as emp_id, $2::uuid as cyc_id
       ),
       quarter_stats AS (
         SELECT 
           quarter,
           COUNT(*) as total_count,
           COUNT(CASE WHEN status = 'submitted' THEN 1 END) as submitted_count,
           COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_count,
           MAX(CASE WHEN status = 'submitted' THEN updated_at END) as submitted_at,
           MAX(CASE WHEN status = 'approved' THEN updated_at END) as approved_at
         FROM kras k, params p
         WHERE k.employee_id = p.emp_id AND k.cycle_id = p.cyc_id AND k.quarter IN (${quartersPlaceholder})
         GROUP BY quarter
       )
       SELECT 
         quarter,
         submitted_at,
         approved_at,
         total_count,
         submitted_count,
         approved_count,
         (total_count > 0 AND (submitted_count + approved_count) = total_count) as all_submitted,
         (total_count > 0 AND approved_count = total_count) as all_approved
       FROM quarter_stats`,
        [employeeId, cycle_id]
      );
    
 
    const selfReviewsResult = await query(
      `SELECT quarter, status, updated_at
       FROM quarterly_self_reviews
       WHERE employee_id = $1 AND cycle_id = $2 AND quarter IN (${quartersPlaceholder})
       ORDER BY quarter, updated_at DESC`,
      [employeeId, cycle_id]
    );
    
    const managerReviewsResult = await query(
      `SELECT quarter, status, updated_at
       FROM quarterly_manager_reviews
       WHERE employee_id = $1 AND cycle_id = $2 AND quarter IN (${quartersPlaceholder})
       ORDER BY quarter, updated_at DESC`,
      [employeeId, cycle_id]
    );
    
    // Build response - include all quarters even if no data
    const quartersData = quartersToInclude.map(quarter => {
      const goalsData = goalsResult.rows.find(g => g.quarter === quarter);
      const selfReview = selfReviewsResult.rows.find(r => r.quarter === quarter);
      const managerReview = managerReviewsResult.rows.find(r => r.quarter === quarter);
      
      let employeeGoalsStatus = 'pending';
      let employeeGoalsSubmittedAt = null;
      let managerGoalsStatus = 'pending';
      let managerGoalsApprovedAt = null;
      
      if (goalsData) {
        if (goalsData.all_submitted) {
          employeeGoalsStatus = 'submitted';
          employeeGoalsSubmittedAt = goalsData.submitted_at || goalsData.approved_at;
        }
        
        if (goalsData.all_approved) {
          managerGoalsStatus = 'approved';
          managerGoalsApprovedAt = goalsData.approved_at;
        } else if (goalsData.all_submitted) {
          managerGoalsStatus = 'pending';
        }
      }
      
      return {
        quarter,
        goals: {
          employee_status: employeeGoalsStatus,
          employee_submitted_at: employeeGoalsSubmittedAt,
          manager_status: managerGoalsStatus,
          manager_approved_at: managerGoalsApprovedAt
        },
        evaluations: {
          employee_status: selfReview?.status === 'submitted' ? 'submitted' : 'pending',
          employee_submitted_at: selfReview?.status === 'submitted' ? selfReview.updated_at : null,
          manager_status: managerReview?.status === 'submitted' || managerReview?.status === 'approved' ? 'submitted' : 'pending',
          manager_submitted_at: (managerReview?.status === 'submitted' || managerReview?.status === 'approved') ? managerReview.updated_at : null
        }
      };
    });
    
    return res.json({
      data: {
        employee: {
          id: employee.id,
          emp_code: employee.emp_code,
          full_name: employee.full_name,
          email: employee.email,
          department: employee.department
        },
        quarters: quartersData
      }
    });
  } catch (error) {
    console.error('Get employee quarterly status error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

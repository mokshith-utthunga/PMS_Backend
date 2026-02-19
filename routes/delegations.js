import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Helper: Check if user is manager of reportee or has active delegation
// Also checks for mid-quarter transitions where user is the new manager
const checkManagerOrDelegate = async (userId, reporteeId, cycleId, quarter) => {
  // Validate and parse quarter parameter
  let parsedQuarter = null;
  if (quarter !== undefined && quarter !== null) {
    // Check if quarter is a valid integer (not a UUID)
    const quarterNum = typeof quarter === 'string' ? parseInt(quarter, 10) : quarter;
    if (isNaN(quarterNum) || quarterNum < 1 || quarterNum > 4) {
      // Invalid quarter - return not authorized
      console.error(`[checkManagerOrDelegate] Invalid quarter value: ${quarter}`);
      return { isAuthorized: false, isDelegate: false };
    }
    parsedQuarter = quarterNum;
  }
  
  // Get current user's employee record
  const empResult = await query(
    'SELECT id, emp_code FROM employees WHERE profile_id = $1',
    [userId]
  );
  
  if (empResult.rows.length === 0) {
    return { isAuthorized: false, isDelegate: false };
  }
  
  const currentEmpId = empResult.rows[0].id;
  const currentEmpCode = empResult.rows[0].emp_code;
  
  // Get reportee's manager_code
  const reporteeResult = await query(
    'SELECT manager_code FROM employees WHERE id = $1',
    [reporteeId]
  );
  
  if (reporteeResult.rows.length === 0) {
    return { isAuthorized: false, isDelegate: false };
  }
  
  const reporteeManagerCode = reporteeResult.rows[0].manager_code;
  
  // Check if user is the direct manager
  if (currentEmpCode === reporteeManagerCode) {
    return { isAuthorized: true, isDelegate: false };
  }
  
  // Check if user has active delegation for this reportee, cycle, and quarter
  if (parsedQuarter !== null) {
    const delegationResult = await query(
      `SELECT id FROM delegations 
       WHERE delegate_id = $1 
         AND reportee_id = $2 
         AND cycle_id = $3 
         AND quarter = $4 
         AND revoked_at IS NULL`,
      [currentEmpId, reporteeId, cycleId, parsedQuarter]
    );
    
    if (delegationResult.rows.length > 0) {
      return { isAuthorized: true, isDelegate: true };
    }
  }
  
  // Check if user is the new manager in an active transition
  // Only authorize if transition_date has passed (post-transition period)
  // This allows new managers to approve goals for post-transition period
  // First check manager_history for accurate historical data, then fallback to employee_quarter_transitions
  if (parsedQuarter !== null) {
    const transitionResult = await query(
      `SELECT eqt.id 
       FROM employee_quarter_transitions eqt
       LEFT JOIN manager_history mh ON mh.transition_id = eqt.id
       WHERE eqt.employee_id = $1 
         AND eqt.cycle_id = $2 
         AND eqt.quarter = $3 
         AND eqt.transition_date <= CURRENT_DATE
         AND (
           COALESCE(mh.new_manager_id, eqt.new_manager_id) = $4
         )`,
      [reporteeId, cycleId, parsedQuarter, currentEmpId]
    );
    
    if (transitionResult.rows.length > 0) {
      console.log(`[Authorization] User ${currentEmpId} is new manager in transition for employee ${reporteeId}, cycle ${cycleId}, quarter ${parsedQuarter}`);
      return { isAuthorized: true, isDelegate: false, isTransitionManager: true };
    }
  }
  
  return { isAuthorized: false, isDelegate: false };
};

// GET /api/delegations - Get delegations for current user
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { manager_id, delegate_id, reportee_id, cycle_id, quarter } = req.query;
    
    // Get current user's employee record
    const empResult = await query(
      'SELECT id FROM employees WHERE profile_id = $1',
      [req.user.userId]
    );
    
    if (empResult.rows.length === 0) {
      return res.json({ data: [] });
    }
    
    const currentEmpId = empResult.rows[0].id;
    
    let sql = `
      SELECT d.*, 
             m.full_name as manager_name, m.email as manager_email, m.emp_code as manager_code,
             del.full_name as delegate_name, del.email as delegate_email, del.emp_code as delegate_code,
             r.full_name as reportee_name, r.email as reportee_email, r.emp_code as reportee_code
      FROM delegations d
      JOIN employees m ON d.manager_id = m.id
      JOIN employees del ON d.delegate_id = del.id
      JOIN employees r ON d.reportee_id = r.id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;
    
    // Filter by manager_id
    if (manager_id) {
      sql += ` AND d.manager_id = $${idx++}`;
      params.push(manager_id);
    } else if (!delegate_id) {
      // Default to current user as manager only if delegate_id is not provided
      sql += ` AND d.manager_id = $${idx++}`;
      params.push(currentEmpId);
    }
    
    // Filter by delegate_id
    if (delegate_id) {
      sql += ` AND d.delegate_id = $${idx++}`;
      params.push(delegate_id);
    }
    if (reportee_id) {
      sql += ` AND d.reportee_id = $${idx++}`;
      params.push(reportee_id);
    }
    if (cycle_id) {
      sql += ` AND d.cycle_id = $${idx++}`;
      params.push(cycle_id);
    }
    if (quarter) {
      sql += ` AND d.quarter = $${idx++}`;
      params.push(parseInt(quarter));
    }
    
    // Only show active delegations by default
    sql += ` AND d.revoked_at IS NULL`;
    sql += ` ORDER BY d.created_at DESC`;
    
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Get delegations error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/delegations - Create delegation
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { delegate_id, reportee_id, cycle_id, quarter } = req.body;
    
    if (!delegate_id || !reportee_id || !cycle_id || !quarter) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (quarter < 1 || quarter > 4) {
      return res.status(400).json({ error: 'Quarter must be between 1 and 4' });
    }
    
    // Get current user's employee record
    const empResult = await query(
      'SELECT id, emp_code FROM employees WHERE profile_id = $1',
      [req.user.userId]
    );
    
    if (empResult.rows.length === 0) {
      return res.status(403).json({ error: 'Employee record not found' });
    }
    
    const managerId = empResult.rows[0].id;
    const managerCode = empResult.rows[0].emp_code;
    
    // Verify user is the manager of the reportee
    const reporteeResult = await query(
      'SELECT manager_code FROM employees WHERE id = $1',
      [reportee_id]
    );
    
    if (reporteeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Reportee not found' });
    }
    
    if (reporteeResult.rows[0].manager_code !== managerCode) {
      return res.status(403).json({ error: 'Not authorized to delegate for this employee' });
    }
    
    // Check if the reportee is already delegated to someone else (prevent sub-delegation)
    const existingDelegationResult = await query(
      `SELECT d.delegate_id, del.full_name as delegate_name
       FROM delegations d
       JOIN employees del ON d.delegate_id = del.id
       WHERE d.reportee_id = $1 
         AND d.cycle_id = $2 
         AND d.quarter = $3 
         AND d.revoked_at IS NULL
         AND d.delegate_id != $4`,
      [reportee_id, cycle_id, quarter, managerId]
    );
    
    if (existingDelegationResult.rows.length > 0) {
      const existingDelegate = existingDelegationResult.rows[0];
      return res.status(403).json({ 
        error: `This employee is already delegated to ${existingDelegate.delegate_name}. Only the original manager can delegate.` 
      });
    }
    
    // Prevent self-delegation
    if (delegate_id === managerId) {
      return res.status(400).json({ error: 'Cannot delegate to yourself' });
    }
    
    // Check if delegate exists
    const delegateResult = await query(
      'SELECT id FROM employees WHERE id = $1',
      [delegate_id]
    );
    
    if (delegateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Delegate not found' });
    }
    
    // Revoke any existing active delegation for this combination
    await query(
      `UPDATE delegations 
       SET revoked_at = NOW(), updated_at = NOW()
       WHERE manager_id = $1 
         AND reportee_id = $2 
         AND cycle_id = $3 
         AND quarter = $4 
         AND revoked_at IS NULL`,
      [managerId, reportee_id, cycle_id, quarter]
    );
    
    // Create new delegation
    const result = await query(
      `INSERT INTO delegations (manager_id, delegate_id, reportee_id, cycle_id, quarter, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING *`,
      [managerId, delegate_id, reportee_id, cycle_id, quarter]
    );
    
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    console.error('Create delegation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/delegations/:id - Revoke delegation
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    // Get current user's employee record
    const empResult = await query(
      'SELECT id FROM employees WHERE profile_id = $1',
      [req.user.userId]
    );
    
    if (empResult.rows.length === 0) {
      return res.status(403).json({ error: 'Employee record not found' });
    }
    
    const currentEmpId = empResult.rows[0].id;
    
    // Get delegation
    const delegationResult = await query(
      'SELECT manager_id, delegate_id FROM delegations WHERE id = $1',
      [req.params.id]
    );
    
    if (delegationResult.rows.length === 0) {
      return res.status(404).json({ error: 'Delegation not found' });
    }
    
    const delegation = delegationResult.rows[0];
    
    // Only manager or delegate can revoke
    if (delegation.manager_id !== currentEmpId && delegation.delegate_id !== currentEmpId) {
      return res.status(403).json({ error: 'Not authorized to revoke this delegation' });
    }
    
    // Revoke delegation
    const result = await query(
      `UPDATE delegations 
       SET revoked_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND revoked_at IS NULL
       RETURNING *`,
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Delegation not found or already revoked' });
    }
    
    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Revoke delegation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/delegations/search - Search employees for delegation
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;
    
    if (!q || q.length < 2) {
      return res.json({ data: [] });
    }
    
    const searchTerm = `%${q}%`;
    
    const result = await query(
      `SELECT id, full_name, email, emp_code, department, grade
       FROM employees
       WHERE status = 'active'
         AND (emp_code ILIKE $1 OR email ILIKE $2 OR full_name ILIKE $3)
       ORDER BY full_name
       LIMIT $4`,
      [searchTerm, searchTerm, searchTerm, parseInt(limit)]
    );
    
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Search employees error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Export helper function for use in other routes
export { checkManagerOrDelegate };

export default router;

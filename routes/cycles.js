import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// GET /api/cycles - Get all cycles
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { status } = req.query;
    let sql = 'SELECT * FROM performance_cycles';
    const params = [];
    
    if (status) {
      sql += ' WHERE status = $1';
      params.push(status);
    }
    sql += ' ORDER BY created_at DESC';
    
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/cycles/active - Get active cycle with dashboard counts for managers
router.get('/active', authMiddleware, async (req, res) => {
  try {
    // Get active cycle
    const cycleResult = await query(
      "SELECT * FROM performance_cycles WHERE status = 'active' ORDER BY created_at DESC LIMIT 1"
    );
    const cycle = cycleResult.rows[0] || null;

    if (!cycle) {
      return res.json({ data: null, dashboard: null });
    }

    // Get current user's employee record (need both id and emp_code)
    const employeeResult = await query(
      'SELECT id, emp_code FROM employees WHERE profile_id = $1',
      [req.user.userId]
    );
    const managerId = employeeResult.rows[0]?.id;
    const managerCode = employeeResult.rows[0]?.emp_code;

    if (!managerId || !managerCode) {
      return res.json({ data: cycle, dashboard: null });
    }

    // Get direct reports (manager_code now references emp_code)
    const directReportsResult = await query(
      "SELECT id FROM employees WHERE manager_code = $1 AND status = 'active'",
      [managerCode]
    );
    const directReportIds = directReportsResult.rows.map(r => r.id);
    const directReportsCount = directReportIds.length;

    if (directReportsCount === 0) {
      return res.json({
        data: cycle,
        dashboard: {
          direct_reports_count: 0,
          goals_pending_approval: 0,
          evaluations_pending: 0,
          quarterly_pending: 0,
          year_end_pending: 0,
          quarterly_open_pending: 0,
        }
      });
    }

    // Build IN clause placeholders for direct report IDs
    const idPlaceholders = directReportIds.map((_, i) => `$${i + 1}`).join(', ');
    const cycleIdIndex = directReportIds.length + 1;

    // Get goals pending approval (status = 'submitted')
    const goalsPendingResult = await query(
      `SELECT COUNT(*) as count FROM goals 
       WHERE employee_id IN (${idPlaceholders}) AND cycle_id = $${cycleIdIndex} AND status = 'submitted'`,
      [...directReportIds, cycle.id]
    );
    const goalsPendingApproval = parseInt(goalsPendingResult.rows[0]?.count || 0);

    // Get quarterly self reviews that are submitted but not reviewed (from quarterly_self_reviews table)
    const quarterlySelfEvalsResult = await query(
      `SELECT qsr.employee_id, qsr.quarter, qsr.status as self_status
       FROM quarterly_self_reviews qsr
       WHERE qsr.employee_id IN (${idPlaceholders}) AND qsr.cycle_id = $${cycleIdIndex} AND qsr.status = 'submitted'`,
      [...directReportIds, cycle.id]
    );

    // Get quarterly manager reviews to check what's been reviewed
    const quarterlyManagerReviewsResult = await query(
      `SELECT employee_id, quarter, status
       FROM quarterly_manager_reviews
       WHERE employee_id IN (${idPlaceholders}) AND cycle_id = $${cycleIdIndex}`,
      [...directReportIds, cycle.id]
    );

    // Create a map of quarterly manager reviews by employee and quarter
    const quarterlyManagerReviewMap = {};
    quarterlyManagerReviewsResult.rows.forEach(qmr => {
      const key = `${qmr.employee_id}_${qmr.quarter}`;
      quarterlyManagerReviewMap[key] = qmr;
    });

    // Get year-end manager evaluations for year-end pending check
    const managerEvalsResult = await query(
      `SELECT employee_id, status
       FROM manager_evaluations
       WHERE employee_id IN (${idPlaceholders}) AND cycle_id = $${cycleIdIndex}`,
      [...directReportIds, cycle.id]
    );

    // Create a map of manager evaluations by employee (for year-end)
    const managerEvalMap = {};
    managerEvalsResult.rows.forEach(me => {
      managerEvalMap[me.employee_id] = me;
    });

    // Calculate quarterly pending counts
    let quarterlyPending = 0;
    let quarterlyOpenPending = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    quarterlySelfEvalsResult.rows.forEach(se => {
      const key = `${se.employee_id}_${se.quarter}`;
      const qmr = quarterlyManagerReviewMap[key];
      // Pending if no manager review OR manager review not submitted/approved
      const hasManagerReview = qmr && (qmr.status === 'submitted' || qmr.status === 'approved');
      
      if (!hasManagerReview) {
        quarterlyPending++;
        
        // Check if this quarter's review period is currently open
        const startField = `q${se.quarter}_manager_review_start`;
        const endField = `q${se.quarter}_manager_review_end`;
        const startDate = cycle[startField] ? new Date(cycle[startField]) : null;
        const endDate = cycle[endField] ? new Date(cycle[endField]) : null;
        
        if (startDate && endDate) {
          startDate.setHours(0, 0, 0, 0);
          endDate.setHours(23, 59, 59, 999);
          if (today >= startDate && today <= endDate) {
            quarterlyOpenPending++;
          }
        }
      }
    });

    // Get year-end self evaluations that are submitted but manager hasn't submitted
    const yearEndSelfEvalsResult = await query(
      `SELECT se.employee_id, se.status as self_status
       FROM self_evaluations se
       WHERE se.employee_id IN (${idPlaceholders}) AND se.cycle_id = $${cycleIdIndex} AND se.quarter IS NULL AND se.status = 'submitted'`,
      [...directReportIds, cycle.id]
    );

    let yearEndPending = 0;
    yearEndSelfEvalsResult.rows.forEach(se => {
      const mgrEval = managerEvalMap[se.employee_id];
      if (!mgrEval || (mgrEval.status !== 'submitted' && mgrEval.status !== 'released')) {
        yearEndPending++;
      }
    });

    // Total evaluations pending = unique employees with any pending evaluation
    const employeesWithPending = new Set();
    quarterlySelfEvalsResult.rows.forEach(se => {
      const key = `${se.employee_id}_${se.quarter}`;
      const qmr = quarterlyManagerReviewMap[key];
      const hasManagerReview = qmr && (qmr.status === 'submitted' || qmr.status === 'approved');
      if (!hasManagerReview) {
        employeesWithPending.add(se.employee_id);
      }
    });
    yearEndSelfEvalsResult.rows.forEach(se => {
      const mgrEval = managerEvalMap[se.employee_id];
      if (!mgrEval || (mgrEval.status !== 'submitted' && mgrEval.status !== 'released')) {
        employeesWithPending.add(se.employee_id);
      }
    });

    res.json({
      data: cycle,
      dashboard: {
        direct_reports_count: directReportsCount,
        goals_pending_approval: goalsPendingApproval,
        evaluations_pending: employeesWithPending.size,
        quarterly_pending: quarterlyPending,
        year_end_pending: yearEndPending,
        quarterly_open_pending: quarterlyOpenPending,
      }
    });
  } catch (error) {
    console.error('Get active cycle error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/cycles/:id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM performance_cycles WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cycle not found' });
    }
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/cycles - Create cycle
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, start_date, end_date, goal_submission_start, goal_submission_end, goal_approval_end, self_evaluation_start, self_evaluation_end, manager_evaluation_start, manager_evaluation_end, calibration_start, calibration_end, release_date, status } = req.body;
    
    const result = await query(
      `INSERT INTO performance_cycles (id, name, start_date, end_date, goal_submission_start, goal_submission_end, goal_approval_end, self_evaluation_start, self_evaluation_end, manager_evaluation_start, manager_evaluation_end, calibration_start, calibration_end, release_date, status, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
       RETURNING *`,
      [name, start_date, end_date, goal_submission_start, goal_submission_end, goal_approval_end, self_evaluation_start, self_evaluation_end, manager_evaluation_start, manager_evaluation_end, calibration_start, calibration_end, release_date, status || 'draft']
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/cycles/:id - Update performance cycle (partial update)
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Validate request body
    if (!updateData || typeof updateData !== 'object' || Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'Request body is required and must not be empty' });
    }

    // Whitelist of allowed fields that can be updated
    const allowedFields = [
      'name',
      'description',
      'year',
      'start_date',
      'end_date',
      'goal_submission_start',
      'goal_submission_end',
      'goal_approval_end',
      'self_evaluation_start',
      'self_evaluation_end',
      'manager_evaluation_start',
      'manager_evaluation_end',
      'calibration_start',
      'calibration_end',
      'release_date',
      'status',
      'allow_late_goal_submission',
      'applicable_departments',
      'applicable_business_units',
      // Quarter-specific fields
      'q1_self_review_start',
      'q1_self_review_end',
      'q1_manager_review_start',
      'q1_manager_review_end',
      'q2_self_review_start',
      'q2_self_review_end',
      'q2_manager_review_start',
      'q2_manager_review_end',
      'q3_self_review_start',
      'q3_self_review_end',
      'q3_manager_review_start',
      'q3_manager_review_end',
      'q4_self_review_start',
      'q4_self_review_end',
      'q4_manager_review_start',
      'q4_manager_review_end'
    ];

    // Fields that should never be updated via this endpoint
    const restrictedFields = ['id', 'created_at', 'created_by'];

    // Filter and validate fields
    const fieldsToUpdate = {};
    const invalidFields = [];

    for (const [key, value] of Object.entries(updateData)) {
      // Skip null/undefined values (client can send null explicitly to clear a field)
      if (value === undefined) {
        continue;
      }

      // Check if field is restricted
      if (restrictedFields.includes(key)) {
        invalidFields.push(`${key} cannot be updated`);
        continue;
      }

      // Check if field is allowed
      if (!allowedFields.includes(key)) {
        invalidFields.push(`${key} is not a valid field`);
        continue;
      }

      fieldsToUpdate[key] = value;
    }

    // Return error if there are invalid fields
    if (invalidFields.length > 0) {
      return res.status(400).json({ 
        error: 'Invalid fields provided', 
        details: invalidFields 
      });
    }

    // Check if there are any fields to update
    if (Object.keys(fieldsToUpdate).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Build dynamic UPDATE query
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(fieldsToUpdate)) {
      setClauses.push(`${key} = $${paramIndex++}`);
      values.push(value);
    }

    // Add updated_at timestamp
    setClauses.push('updated_at = NOW()');
    
    // Add WHERE clause parameter
    values.push(id);

    const sqlQuery = `
      UPDATE performance_cycles 
      SET ${setClauses.join(', ')} 
      WHERE id = $${paramIndex} 
      RETURNING *
    `;

    const result = await query(sqlQuery, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Performance cycle not found' });
    }

    res.json({ 
      data: result.rows[0],
      message: 'Performance cycle updated successfully'
    });
  } catch (error) {
    console.error('Update performance cycle error:', error);
    res.status(500).json({ 
      error: 'Failed to update performance cycle',
      message: error.message 
    });
  }
});

// DELETE /api/cycles/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM performance_cycles WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cycle not found' });
    }
    res.json({ message: 'Cycle deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

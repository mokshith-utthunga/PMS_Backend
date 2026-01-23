import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

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
      return res.json({ data: null, quarterly_cycles: [], goals_quarterly_cycles: [], dashboard: null });
    }

    // Get quarterly cycles data (always fetch)
    const quarterlyCyclesResult = await query(
      `SELECT id, performance_cycle_id, quarter, quarter_start_date, quarter_end_date,
              self_review_start_date, self_review_end_date,
              manager_review_start_date as quarterly_manager_review_start_date, 
              manager_review_end_date as quarterly_manager_review_end_date, status
       FROM quarterly_cycles
       WHERE performance_cycle_id = $1
       ORDER BY quarter`,
      [cycle.id]
    );

    // Get goals quarterly cycles data (always fetch)
    const goalsQuarterlyCyclesResult = await query(
      `SELECT gqc.id, gqc.performance_cycle_id, gqc.quarter,
              qc.id as quarterly_cycle_id,
              qc.quarter_start_date as quarterly_start_date,
              qc.quarter_end_date as quarterly_end_date,
              gqc.goal_submission_start_date, gqc.goal_submission_end_date,
              gqc.manager_review_start_date as goals_manager_review_start_date, 
              gqc.manager_review_end_date as goals_manager_review_end_date,
              gqc.allow_late_goal_submission, gqc.status,
              gqc.created_at, gqc.updated_at
       FROM goals_quarterly_cycles gqc
       LEFT JOIN quarterly_cycles qc ON qc.performance_cycle_id = gqc.performance_cycle_id AND qc.quarter = gqc.quarter
       WHERE gqc.performance_cycle_id = $1
       ORDER BY gqc.quarter`,
      [cycle.id]
    );

    // Get current user's employee record (need both id and emp_code)
    const employeeResult = await query(
      'SELECT id, emp_code FROM employees WHERE profile_id = $1',
      [req.user.userId]
    );
    const managerId = employeeResult.rows[0]?.id;
    const managerCode = employeeResult.rows[0]?.emp_code;

    if (!managerId || !managerCode) {
      return res.json({ 
        data: cycle, 
        quarterly_cycles: quarterlyCyclesResult.rows,
        goals_quarterly_cycles: goalsQuarterlyCyclesResult.rows,
        dashboard: null 
      });
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
        quarterly_cycles: quarterlyCyclesResult.rows,
        goals_quarterly_cycles: goalsQuarterlyCyclesResult.rows,
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
      quarterly_cycles: quarterlyCyclesResult.rows,
      goals_quarterly_cycles: goalsQuarterlyCyclesResult.rows,
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
// Note: Annual columns (goal_submission_*, self_evaluation_*, manager_evaluation_*) have been moved to quarterly tables
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, description, year, start_date, end_date, calibration_start, calibration_end, release_date, status, applicable_departments, applicable_business_units } = req.body;
    
    // Handle array fields for PostgreSQL
    let deptClause = 'NULL';
    let buClause = 'NULL';
    
    if (applicable_departments && Array.isArray(applicable_departments) && applicable_departments.length > 0) {
      const escapedDepts = applicable_departments.map(d => `'${String(d).replace(/'/g, "''")}'`).join(', ');
      deptClause = `ARRAY[${escapedDepts}]::text[]`;
    }
    
    if (applicable_business_units && Array.isArray(applicable_business_units) && applicable_business_units.length > 0) {
      const escapedBUs = applicable_business_units.map(b => `'${String(b).replace(/'/g, "''")}'`).join(', ');
      buClause = `ARRAY[${escapedBUs}]::text[]`;
    }
    
    const result = await query(
      `INSERT INTO performance_cycles (id, name, description, year, start_date, end_date, calibration_start, calibration_end, release_date, status, applicable_departments, applicable_business_units, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, ${deptClause}, ${buClause}, NOW(), NOW())
       RETURNING *`,
      [name, description || null, year || new Date().getFullYear(), start_date || null, end_date || null, calibration_start || null, calibration_end || null, release_date || null, status || 'draft']
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
    // Note: manager_evaluation_start/end, self_evaluation_start/end, goal_submission_* removed
    // These are now stored in quarterly_cycles and goals_quarterly_cycles tables
    const allowedFields = [
      'name',
      'description',
      'year',
      'start_date',
      'end_date',
      'calibration_start',
      'calibration_end',
      'release_date',
      'status',
      'allow_late_goal_submission',
      'applicable_departments',
      'applicable_business_units'
      // Note: Quarterly fields (q1_*, q2_*, q3_*, q4_*) have been moved to quarterly_cycles table
      // Use PUT /api/cycles/:id/quarterly-cycles/:quarter to update quarterly data
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
      // Handle array fields for PostgreSQL - format as PostgreSQL array literal
      if ((key === 'applicable_departments' || key === 'applicable_business_units')) {
        if (value === null) {
          setClauses.push(`${key} = NULL`);
        } else {
          // Ensure value is an array
          let arrayValue = value;
          if (!Array.isArray(value)) {
            if (typeof value === 'string') {
              // Try to parse as JSON array
              try {
                const parsed = JSON.parse(value);
                arrayValue = Array.isArray(parsed) ? parsed : [value];
              } catch {
                // If parsing fails, treat as single-item array
                arrayValue = [value];
              }
            } else {
              arrayValue = [value];
            }
          }
          // Format as PostgreSQL array literal: ARRAY['value1', 'value2']::text[]
          const escapedValues = arrayValue.map(v => `'${String(v).replace(/'/g, "''")}'`).join(', ');
          setClauses.push(`${key} = ARRAY[${escapedValues}]::text[]`);
        }
      } else {
        setClauses.push(`${key} = $${paramIndex++}`);
        values.push(value);
      }
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

// GET /api/cycles/:id/quarterly-cycles - Get all quarterly cycles for a performance cycle
router.get('/:id/quarterly-cycles', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM quarterly_cycles WHERE performance_cycle_id = $1 ORDER BY quarter',
      [req.params.id]
    );
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Get quarterly cycles error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/cycles/:id/quarterly-cycles/:quarter - Update quarterly cycle (HR/Admin only)
router.put('/:id/quarterly-cycles/:quarter', authMiddleware, requireRole(['hr_admin', 'system_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const quarter = parseInt(req.params.quarter);
    const updateData = req.body;

    if (quarter < 1 || quarter > 4) {
      return res.status(400).json({ error: 'Quarter must be between 1 and 4' });
    }

    // Validate request body
    if (!updateData || typeof updateData !== 'object' || Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'Request body is required and must not be empty' });
    }

    // Whitelist of allowed fields
    const allowedFields = [
      'quarter_start_date',
      'quarter_end_date',
      'self_review_start_date',
      'self_review_end_date',
      'manager_review_start_date',
      'manager_review_end_date',
      'status'
    ];

    // Fields that should never be updated via this endpoint
    const restrictedFields = ['id', 'performance_cycle_id', 'quarter', 'created_at'];

    // Filter and validate fields
    const fieldsToUpdate = {};
    const invalidFields = [];

    for (const [key, value] of Object.entries(updateData)) {
      if (value === undefined) {
        continue;
      }

      if (restrictedFields.includes(key)) {
        invalidFields.push(`${key} cannot be updated`);
        continue;
      }

      if (!allowedFields.includes(key)) {
        invalidFields.push(`${key} is not a valid field`);
        continue;
      }

      fieldsToUpdate[key] = value;
    }

    if (invalidFields.length > 0) {
      return res.status(400).json({ 
        error: 'Invalid fields provided', 
        details: invalidFields 
      });
    }

    if (Object.keys(fieldsToUpdate).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Get performance cycle year for default quarter dates
    const cycleResult = await query('SELECT year FROM performance_cycles WHERE id = $1', [id]);
    if (cycleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Performance cycle not found' });
    }
    const year = cycleResult.rows[0].year;
    
    // Calculate default quarter dates
    const quarterStartMonths = { 1: '01-01', 2: '04-01', 3: '07-01', 4: '10-01' };
    const quarterEndMonths = { 1: '03-31', 2: '06-30', 3: '09-30', 4: '12-31' };
    const defaultStartDate = `${year}-${quarterStartMonths[quarter]}`;
    const defaultEndDate = `${year}-${quarterEndMonths[quarter]}`;

    // Check if record exists to get current values
    const existingResult = await query(
      'SELECT * FROM quarterly_cycles WHERE performance_cycle_id = $1 AND quarter = $2',
      [id, quarter]
    );
    
    // Determine final values (merge existing with updates)
    const existing = existingResult.rows[0] || {};
    const finalQuarterStart = fieldsToUpdate.quarter_start_date || existing.quarter_start_date || defaultStartDate;
    const finalQuarterEnd = fieldsToUpdate.quarter_end_date || existing.quarter_end_date || defaultEndDate;
    
    // For self review dates, use provided values, existing values, or null (nullable columns)
    let finalSelfReviewStart = fieldsToUpdate.self_review_start_date !== undefined 
      ? fieldsToUpdate.self_review_start_date 
      : (existing.self_review_start_date || null);
    let finalSelfReviewEnd = fieldsToUpdate.self_review_end_date !== undefined 
      ? fieldsToUpdate.self_review_end_date 
      : (existing.self_review_end_date || null);
    
    // For manager review dates, use provided values, existing values, or quarter end date (NOT NULL columns)
    // manager_review_start_date and manager_review_end_date are NOT NULL
    let finalManagerReviewStart = fieldsToUpdate.manager_review_start_date !== undefined 
      ? fieldsToUpdate.manager_review_start_date 
      : (existing.manager_review_start_date || finalQuarterEnd);
    let finalManagerReviewEnd = fieldsToUpdate.manager_review_end_date !== undefined 
      ? fieldsToUpdate.manager_review_end_date 
      : (existing.manager_review_end_date || finalQuarterEnd);
    
    // Ensure manager_review_start_date <= manager_review_end_date (constraint requirement)
    if (new Date(finalManagerReviewStart) > new Date(finalManagerReviewEnd)) {
      // If start > end, set both to the same date (the end date)
      finalManagerReviewStart = finalManagerReviewEnd;
    }
    
    // If only quarter dates are being updated, check if review dates would violate constraints
    // and reset them if necessary
    if ((fieldsToUpdate.quarter_start_date || fieldsToUpdate.quarter_end_date) && 
        !fieldsToUpdate.self_review_start_date && !fieldsToUpdate.self_review_end_date &&
        !fieldsToUpdate.manager_review_start_date && !fieldsToUpdate.manager_review_end_date) {
      const qEnd = new Date(finalQuarterEnd);
      
      // Clear self review dates if they're outside the new quarter range (nullable columns)
      if (finalSelfReviewStart && new Date(finalSelfReviewStart) > qEnd) {
        finalSelfReviewStart = null;
      }
      if (finalSelfReviewEnd && new Date(finalSelfReviewEnd) > qEnd) {
        finalSelfReviewEnd = null;
      }
      
      // For manager review dates, clamp them to quarter end date if needed (NOT NULL columns)
      if (new Date(finalManagerReviewStart) > qEnd) {
        finalManagerReviewStart = finalQuarterEnd;
      }
      if (new Date(finalManagerReviewEnd) > qEnd) {
        finalManagerReviewEnd = finalQuarterEnd;
      }
      
      // Re-check manager review dates constraint after clamping
      if (new Date(finalManagerReviewStart) > new Date(finalManagerReviewEnd)) {
        finalManagerReviewStart = finalManagerReviewEnd;
      }
    }
    
    // Validate all dates are within quarter range
    const qStart = new Date(finalQuarterStart);
    const qEnd = new Date(finalQuarterEnd);
    qStart.setHours(0, 0, 0, 0);
    qEnd.setHours(23, 59, 59, 999);
    
    const dateValidations = [
      { date: finalSelfReviewStart, label: 'Employee Review Start' },
      { date: finalSelfReviewEnd, label: 'Employee Review End' },
      { date: finalManagerReviewStart, label: 'Manager Review Start' },
      { date: finalManagerReviewEnd, label: 'Manager Review End' },
    ];
    
    for (const { date, label } of dateValidations) {
      if (date) {
        const d = new Date(date);
        if (d < qStart || d > qEnd) {
          return res.status(400).json({ 
            error: 'Date out of range',
            message: `${label} (${date}) must be between Quarter Start (${finalQuarterStart}) and Quarter End (${finalQuarterEnd}).`
          });
        }
      }
    }

    // Use a single UPSERT with all final values
    // Note: Each $n placeholder must be unique because the query helper converts them to ?
    const sqlQuery = `
      INSERT INTO quarterly_cycles (
        performance_cycle_id, quarter,
        quarter_start_date, quarter_end_date,
        self_review_start_date, self_review_end_date,
        manager_review_start_date, manager_review_end_date,
        status, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      ON CONFLICT (performance_cycle_id, quarter) 
      DO UPDATE SET 
        quarter_start_date = $10,
        quarter_end_date = $11,
        self_review_start_date = $12,
        self_review_end_date = $13,
        manager_review_start_date = $14,
        manager_review_end_date = $15,
        status = COALESCE($16, quarterly_cycles.status),
        updated_at = NOW()
      RETURNING *
    `;

    const finalStatus = fieldsToUpdate.status || existing.status || 'draft';
    const result = await query(sqlQuery, [
      // INSERT values ($1-$9)
      id, quarter,
      finalQuarterStart,
      finalQuarterEnd,
      finalSelfReviewStart,
      finalSelfReviewEnd,
      finalManagerReviewStart,
      finalManagerReviewEnd,
      finalStatus,
      // UPDATE values ($10-$16)
      finalQuarterStart,
      finalQuarterEnd,
      finalSelfReviewStart,
      finalSelfReviewEnd,
      finalManagerReviewStart,
      finalManagerReviewEnd,
      finalStatus
    ]);

    res.json({ 
      data: result.rows[0],
      message: 'Quarterly cycle updated successfully'
    });
  } catch (error) {
    console.error('Update quarterly cycle error:', error);
    res.status(500).json({ 
      error: 'Failed to update quarterly cycle',
      message: error.message 
    });
  }
});

// GET /api/cycles/:id/goals-quarterly-cycles - Get all goals quarterly cycles for a performance cycle
// Joins with quarterly_cycles to get quarter date range
router.get('/:id/goals-quarterly-cycles', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      `SELECT gqc.id, gqc.performance_cycle_id, gqc.quarter,
              qc.id as quarterly_cycle_id,
              qc.quarter_start_date as quarterly_start_date,
              qc.quarter_end_date as quarterly_end_date,
              gqc.goal_submission_start_date, gqc.goal_submission_end_date,
              gqc.manager_review_start_date, gqc.manager_review_end_date,
              gqc.allow_late_goal_submission, gqc.status,
              gqc.created_at, gqc.updated_at
       FROM goals_quarterly_cycles gqc
       LEFT JOIN quarterly_cycles qc ON qc.performance_cycle_id = gqc.performance_cycle_id AND qc.quarter = gqc.quarter
       WHERE gqc.performance_cycle_id = $1 
       ORDER BY gqc.quarter`,
      [req.params.id]
    );
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Get goals quarterly cycles error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/cycles/:id/goals-quarterly-cycles/:quarter - Get specific quarter's goals cycle
// Joins with quarterly_cycles to get quarter date range
router.get('/:id/goals-quarterly-cycles/:quarter', authMiddleware, async (req, res) => {
  try {
    const quarter = parseInt(req.params.quarter);
    if (quarter < 1 || quarter > 4) {
      return res.status(400).json({ error: 'Quarter must be between 1 and 4' });
    }

    const result = await query(
      `SELECT gqc.id, gqc.performance_cycle_id, gqc.quarter,
              qc.id as quarterly_cycle_id,
              qc.quarter_start_date as quarterly_start_date,
              qc.quarter_end_date as quarterly_end_date,
              gqc.goal_submission_start_date, gqc.goal_submission_end_date,
              gqc.manager_review_start_date, gqc.manager_review_end_date,
              gqc.allow_late_goal_submission, gqc.status,
              gqc.created_at, gqc.updated_at
       FROM goals_quarterly_cycles gqc
       LEFT JOIN quarterly_cycles qc ON qc.performance_cycle_id = gqc.performance_cycle_id AND qc.quarter = gqc.quarter
       WHERE gqc.performance_cycle_id = $1 AND gqc.quarter = $2`,
      [req.params.id, quarter]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Goals quarterly cycle not found' });
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Get goals quarterly cycle error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/cycles/:id/goals-quarterly-cycles/:quarter - Update goals quarterly cycle (HR/Admin only)
// Quarter dates are fetched from quarterly_cycles table via performance_cycle_id + quarter join
router.put('/:id/goals-quarterly-cycles/:quarter', authMiddleware, requireRole(['hr_admin', 'system_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const quarter = parseInt(req.params.quarter);
    const updateData = req.body;

    if (quarter < 1 || quarter > 4) {
      return res.status(400).json({ error: 'Quarter must be between 1 and 4' });
    }

    // Validate request body
    if (!updateData || typeof updateData !== 'object' || Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'Request body is required and must not be empty' });
    }

    // Whitelist of allowed fields (quarterly_start_date/quarterly_end_date removed - now from quarterly_cycles FK)
    const allowedFields = [
      'goal_submission_start_date',
      'goal_submission_end_date',
      'manager_review_start_date',
      'manager_review_end_date',
      'allow_late_goal_submission',
      'status'
    ];

    // Fields that should never be updated via this endpoint
    const restrictedFields = ['id', 'performance_cycle_id', 'quarter', 'created_at'];

    // Filter and validate fields
    const fieldsToUpdate = {};
    const invalidFields = [];

    for (const [key, value] of Object.entries(updateData)) {
      if (value === undefined) {
        continue;
      }

      if (restrictedFields.includes(key)) {
        invalidFields.push(`${key} cannot be updated`);
        continue;
      }

      if (!allowedFields.includes(key)) {
        // Silently skip deprecated fields
        if (key === 'quarterly_start_date' || key === 'quarterly_end_date') {
          continue;
        }
        invalidFields.push(`${key} is not a valid field`);
        continue;
      }

      fieldsToUpdate[key] = value;
    }

    if (invalidFields.length > 0) {
      return res.status(400).json({ 
        error: 'Invalid fields provided', 
        details: invalidFields 
      });
    }

    if (Object.keys(fieldsToUpdate).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Get or create quarterly_cycle for this quarter
    // First, check if quarterly_cycle exists
    let qcResult = await query(
      'SELECT id, quarter_start_date, quarter_end_date FROM quarterly_cycles WHERE performance_cycle_id = $1 AND quarter = $2',
      [id, quarter]
    );
    
    let quarterlyCycleId;
    let quarterlyStartDate;
    let quarterlyEndDate;
    
    if (qcResult.rows.length === 0) {
      // No quarterly_cycle exists - create one with default dates
      const cycleResult = await query('SELECT year FROM performance_cycles WHERE id = $1', [id]);
      if (cycleResult.rows.length === 0) {
        return res.status(404).json({ error: 'Performance cycle not found' });
      }
      const year = cycleResult.rows[0].year;
      
      // Calculate default quarter dates
      const quarterStartMonths = { 1: '01-01', 2: '04-01', 3: '07-01', 4: '10-01' };
      const quarterEndMonths = { 1: '03-31', 2: '06-30', 3: '09-30', 4: '12-31' };
      quarterlyStartDate = `${year}-${quarterStartMonths[quarter]}`;
      quarterlyEndDate = `${year}-${quarterEndMonths[quarter]}`;
      
      // Create quarterly_cycle
      const newQcResult = await query(
        `INSERT INTO quarterly_cycles (performance_cycle_id, quarter, quarter_start_date, quarter_end_date, manager_review_start_date, manager_review_end_date, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft')
         RETURNING id`,
        [id, quarter, quarterlyStartDate, quarterlyEndDate, quarterlyEndDate, quarterlyEndDate]
      );
      quarterlyCycleId = newQcResult.rows[0].id;
    } else {
      quarterlyCycleId = qcResult.rows[0].id;
      quarterlyStartDate = qcResult.rows[0].quarter_start_date;
      quarterlyEndDate = qcResult.rows[0].quarter_end_date;
    }
    
    // Validate that goal and manager review dates are within quarterly date range
    const validationErrors = [];
    
    if (fieldsToUpdate.goal_submission_start_date && quarterlyStartDate && quarterlyEndDate) {
      if (new Date(fieldsToUpdate.goal_submission_start_date) < new Date(quarterlyStartDate) ||
          new Date(fieldsToUpdate.goal_submission_start_date) > new Date(quarterlyEndDate)) {
        validationErrors.push(`goal_submission_start_date (${fieldsToUpdate.goal_submission_start_date}) must be between quarter_start_date (${quarterlyStartDate}) and quarter_end_date (${quarterlyEndDate})`);
      }
    }
    
    if (fieldsToUpdate.goal_submission_end_date && quarterlyStartDate && quarterlyEndDate) {
      if (new Date(fieldsToUpdate.goal_submission_end_date) < new Date(quarterlyStartDate) ||
          new Date(fieldsToUpdate.goal_submission_end_date) > new Date(quarterlyEndDate)) {
        validationErrors.push(`goal_submission_end_date (${fieldsToUpdate.goal_submission_end_date}) must be between quarter_start_date (${quarterlyStartDate}) and quarter_end_date (${quarterlyEndDate})`);
      }
    }
    
    if (fieldsToUpdate.manager_review_start_date && quarterlyStartDate && quarterlyEndDate) {
      if (new Date(fieldsToUpdate.manager_review_start_date) < new Date(quarterlyStartDate) ||
          new Date(fieldsToUpdate.manager_review_start_date) > new Date(quarterlyEndDate)) {
        validationErrors.push(`manager_review_start_date (${fieldsToUpdate.manager_review_start_date}) must be between quarter_start_date (${quarterlyStartDate}) and quarter_end_date (${quarterlyEndDate})`);
      }
    }
    
    if (fieldsToUpdate.manager_review_end_date && quarterlyStartDate && quarterlyEndDate) {
      if (new Date(fieldsToUpdate.manager_review_end_date) < new Date(quarterlyStartDate) ||
          new Date(fieldsToUpdate.manager_review_end_date) > new Date(quarterlyEndDate)) {
        validationErrors.push(`manager_review_end_date (${fieldsToUpdate.manager_review_end_date}) must be between quarter_start_date (${quarterlyStartDate}) and quarter_end_date (${quarterlyEndDate})`);
      }
    }
    
    if (validationErrors.length > 0) {
      return res.status(400).json({
        error: 'Date validation failed',
        details: validationErrors
      });
    }

    // Build INSERT values first (for new records)
    // Note: goals_quarterly_cycles links to quarterly_cycles via performance_cycle_id + quarter, not quarterly_cycle_id FK
    const insertFields = [
      'performance_cycle_id', 'quarter',
      'goal_submission_start_date', 'goal_submission_end_date',
      'manager_review_start_date', 'manager_review_end_date',
      'allow_late_goal_submission', 'status'
    ];
    
    const insertValues = [
      id, quarter,
      fieldsToUpdate.goal_submission_start_date || quarterlyStartDate,
      fieldsToUpdate.goal_submission_end_date || quarterlyEndDate,
      fieldsToUpdate.manager_review_start_date || quarterlyEndDate,
      fieldsToUpdate.manager_review_end_date || quarterlyEndDate,
      fieldsToUpdate.allow_late_goal_submission !== undefined ? fieldsToUpdate.allow_late_goal_submission : false,
      fieldsToUpdate.status || 'draft'
    ];

    // Build UPDATE clauses (for existing records)
    // Parameter index starts after INSERT values
    const updateClauses = [];
    let updateParamIndex = insertValues.length + 1;

    // Add all fields to update
    for (const [key, value] of Object.entries(fieldsToUpdate)) {
      updateClauses.push(`${key} = $${updateParamIndex++}`);
    }

    // Add updated_at timestamp
    updateClauses.push('updated_at = NOW()');

    // Build placeholders for INSERT
    const insertPlaceholders = insertValues.map((_, idx) => `$${idx + 1}`).join(', ');
    
    // Combine INSERT and UPDATE parameter values
    const allValues = [...insertValues, ...Object.values(fieldsToUpdate)];

    const sqlQuery = `
      INSERT INTO goals_quarterly_cycles (${insertFields.join(', ')}, created_at, updated_at)
      VALUES (${insertPlaceholders}, NOW(), NOW())
      ON CONFLICT (performance_cycle_id, quarter) 
      DO UPDATE SET ${updateClauses.join(', ')}
      RETURNING *
    `;

    const result = await query(sqlQuery, allValues);

    res.json({ 
      data: result.rows[0],
      message: 'Goals quarterly cycle updated successfully'
    });
  } catch (error) {
    console.error('Update goals quarterly cycle error:', error);
    res.status(500).json({ 
      error: 'Failed to update goals quarterly cycle',
      message: error.message 
    });
  }
});

export default router;

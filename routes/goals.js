import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { checkManagerOrDelegate } from './delegations.js';

const router = express.Router();

// GET /api/goals - Get goals with filters
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, status, type, quarter, period_type, transition_id } = req.query;
    
    let sql = 'SELECT * FROM goals WHERE 1=1';
    const params = [];
    let idx = 1;

    if (employee_id) {
      sql += ` AND employee_id = $${idx++}`;
      params.push(employee_id);
    }
    if (cycle_id) {
      sql += ` AND cycle_id = $${idx++}`;
      params.push(cycle_id);
    }
    if (status) {
      sql += ` AND status = $${idx++}`;
      params.push(status);
    }
    if (type) {
      sql += ` AND type = $${idx++}`;
      params.push(type);
    }
    if (quarter) {
      sql += ` AND quarter = $${idx++}`;
      params.push(parseInt(quarter));
    }
    if (period_type) {
      sql += ` AND period_type = $${idx++}::period_type`;
      params.push(period_type);
    }
    if (transition_id) {
      sql += ` AND transition_id = $${idx++}`;
      params.push(transition_id);
    } else if (period_type && period_type !== 'full_quarter') {
      // If period_type is specified but not full_quarter, ensure we filter by transition_id
      // This prevents mixing full_quarter goals with transition goals
      sql += ` AND transition_id IS NOT NULL`;
    }

    sql += ' ORDER BY created_at DESC';
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/goals/my - Get current user's goals
router.get('/my', authMiddleware, async (req, res) => {
  try {
    const { cycle_id, quarter } = req.query;
    
    // First get employee ID for current user
    const empResult = await query(
      'SELECT id FROM employees WHERE profile_id = $1',
      [req.user.userId]
    );
    
    if (empResult.rows.length === 0) {
      return res.json({ data: [] });
    }
    
    let sql = 'SELECT * FROM goals WHERE employee_id = $1';
    const params = [empResult.rows[0].id];
    let idx = 2;
    
    if (cycle_id) {
      sql += ` AND cycle_id = $${idx++}`;
      params.push(cycle_id);
    }
    if (quarter) {
      sql += ` AND quarter = $${idx++}`;
      params.push(parseInt(quarter));
    }
    sql += ' ORDER BY created_at DESC';
    
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/goals/pending-approvals - For managers (includes delegated)
router.get('/pending-approvals', authMiddleware, async (req, res) => {
  try {
    const { cycle_id, quarter } = req.query;
    
    // Get manager's employee record (need emp_code for manager_code query)
    const empResult = await query(
      'SELECT id, emp_code FROM employees WHERE profile_id = $1',
      [req.user.userId]
    );
    
    if (empResult.rows.length === 0) {
      return res.json({ data: [], count: 0 });
    }
    
    const managerId = empResult.rows[0].id;
    const managerCode = empResult.rows[0].emp_code;
    
    let sql = `
      SELECT DISTINCT g.*, e.full_name, e.email
      FROM goals g
      JOIN employees e ON g.employee_id = e.id
      WHERE g.status = 'submitted'
        AND (
          e.manager_code = $1
          OR EXISTS (
            SELECT 1 FROM delegations d
            WHERE d.delegate_id = $2
              AND d.reportee_id = e.id
              AND d.cycle_id = g.cycle_id
              AND d.quarter = g.quarter
              AND d.revoked_at IS NULL
          )
        )
    `;
    const params = [managerCode, managerId];
    let idx = 3;
    
    if (cycle_id) {
      sql += ` AND g.cycle_id = $${idx++}`;
      params.push(cycle_id);
    }
    if (quarter) {
      sql += ` AND g.quarter = $${idx++}`;
      params.push(parseInt(quarter));
    }
    
    const result = await query(sql, params);
    const uniqueEmployees = new Set(result.rows.map(row => row.employee_id));
    res.json({ data: result.rows, count: uniqueEmployees.size});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/goals/clone - Clone goals from one quarter to another
// IMPORTANT: This must be defined BEFORE /:id route to avoid matching "clone" as an ID
router.post('/clone', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, source_quarter, target_quarter } = req.body;

    if (!employee_id || !cycle_id || !source_quarter || !target_quarter) {
      return res.status(400).json({ error: 'Missing required fields: employee_id, cycle_id, source_quarter, target_quarter' });
    }

    if (source_quarter === target_quarter) {
      return res.status(400).json({ error: 'Source and target quarters must be different' });
    }

    if (source_quarter < 1 || source_quarter > 4 || target_quarter < 1 || target_quarter > 4) {
      return res.status(400).json({ error: 'Quarter must be between 1 and 4' });
    }

    // Check if target quarter already has goals
    const existingGoals = await query(
      `SELECT g.id FROM goals g
       INNER JOIN kras k ON g.kra_id = k.id
       WHERE k.employee_id = $1 AND k.cycle_id = $2 AND k.quarter = $3`,
      [employee_id, cycle_id, target_quarter]
    );

    if (existingGoals.rows.length > 0) {
      return res.status(400).json({ error: `Target quarter (Q${target_quarter}) already has goals. Please delete existing goals before cloning.` });
    }

    // Get all KRAs from source quarter
    const sourceKRAs = await query(
      'SELECT * FROM kras WHERE employee_id = $1 AND cycle_id = $2 AND quarter = $3',
      [employee_id, cycle_id, source_quarter]
    );

    if (sourceKRAs.rows.length === 0) {
      return res.status(404).json({ error: `No goals found in source quarter (Q${source_quarter})` });
    }

    const clonedKRAs = [];
    const clonedKPIs = [];

    // Clone each KRA and its KPIs
    for (const sourceKRA of sourceKRAs.rows) {
      // Create new KRA for target quarter
      const newKRA = await query(
        `INSERT INTO kras (id, employee_id, cycle_id, kra_template_id, title, description, weight, status, quarter, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         RETURNING *`,
        [
          sourceKRA.employee_id,
          sourceKRA.cycle_id,
          sourceKRA.kra_template_id,
          sourceKRA.title,
          sourceKRA.description,
          sourceKRA.weight,
          'draft', // Reset status to draft for cloned KRA
          target_quarter
        ]
      );

      const clonedKRA = newKRA.rows[0];
      clonedKRAs.push(clonedKRA);

      // Get all KPIs for this KRA from source quarter
      const sourceKPIs = await query(
        'SELECT * FROM goals WHERE kra_id = $1 AND quarter = $2',
        [sourceKRA.id, source_quarter]
      );

      // Clone each KPI
      for (const sourceKPI of sourceKPIs.rows) {
        // Handle calibration data - PostgreSQL JSONB returns as object, need to stringify for INSERT
        let calibrationJson = null;
        if (sourceKPI.calibration !== null && sourceKPI.calibration !== undefined) {
          if (typeof sourceKPI.calibration === 'string') {
            // Already a JSON string, validate it
            try {
              JSON.parse(sourceKPI.calibration);
              calibrationJson = sourceKPI.calibration;
            } catch (e) {
              // Invalid JSON string, set to null
              calibrationJson = null;
            }
          } else {
            // PostgreSQL JSONB returns as object/array, convert to JSON string
            calibrationJson = JSON.stringify(sourceKPI.calibration);
          }
        }

        const newKPI = await query(
          `INSERT INTO goals (id, employee_id, cycle_id, kra_id, kpi_template_id, title, description, goal_type, metric_type, target_value, weight, calibration, due_date, status, quarter, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
           RETURNING *`,
          [
            sourceKPI.employee_id,
            sourceKPI.cycle_id,
            clonedKRA.id, // Link to new KRA
            sourceKPI.kpi_template_id,
            sourceKPI.title,
            sourceKPI.description,
            sourceKPI.goal_type,
            sourceKPI.metric_type,
            sourceKPI.target_value,
            sourceKPI.weight,
            calibrationJson, // Use properly formatted calibration JSON
            sourceKPI.due_date,
            'draft', // Reset status to draft for cloned KPI
            target_quarter
          ]
        );

        clonedKPIs.push(newKPI.rows[0]);
      }
    }

    res.json({
      data: {
        kras: clonedKRAs,
        kpis: clonedKPIs
      },
      message: `Successfully cloned ${clonedKRAs.length} KRAs and ${clonedKPIs.length} KPIs from Q${source_quarter} to Q${target_quarter}`
    });
  } catch (error) {
    console.error('Error cloning goals:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/goals/:id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM goals WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/goals
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, kra_id, kpi_template_id, goal_type, title, description, weight, target_value, metric_type, due_date, status, calibration, quarter, period_type, transition_id } = req.body;
    
    // Validate and format calibration if provided
    let calibrationJson = null;
    if (calibration) {
      if (Array.isArray(calibration)) {
        calibrationJson = JSON.stringify(calibration);
      } else if (typeof calibration === 'string') {
        // Already JSON string, validate it
        JSON.parse(calibration);
        calibrationJson = calibration;
      }
    }

    // Auto-detect transition if not explicitly provided
    let periodType = period_type || null;
    let transitionId = transition_id || null;
    let periodStartDate = null;
    let periodEndDate = null;

    if (employee_id && cycle_id && quarter && !periodType && !transitionId) {
      // Check if there's an active transition for this employee/cycle/quarter
      const transitionResult = await query(
        `SELECT id, transition_date
         FROM employee_quarter_transitions 
         WHERE employee_id = $1 AND cycle_id = $2 AND quarter = $3`,
        [employee_id, cycle_id, quarter]
      );

      if (transitionResult.rows.length > 0) {
        const transition = transitionResult.rows[0];
        transitionId = transition.id;
        const transitionDate = new Date(transition.transition_date);
        const now = new Date();
        transitionDate.setHours(0, 0, 0, 0);
        
        // Get quarter date range
        const quarterRange = await query(
          `SELECT quarterly_start_date, quarterly_end_date 
           FROM goals_quarterly_cycles 
           WHERE performance_cycle_id = $1 AND quarter = $2`,
          [cycle_id, quarter]
        );
        
        if (quarterRange.rows.length > 0) {
          const quarterStart = new Date(quarterRange.rows[0].quarterly_start_date);
          const quarterEnd = new Date(quarterRange.rows[0].quarterly_end_date);
          
          if (now >= transitionDate) {
            // Goal is being created after transition, mark as post_transition
            periodType = 'post_transition';
            periodStartDate = transitionDate.toISOString().split('T')[0];
            periodEndDate = quarterEnd.toISOString().split('T')[0];
          } else {
            // Goal is being created before transition, mark as pre_transition
            periodType = 'pre_transition';
            periodStartDate = quarterStart.toISOString().split('T')[0];
            const preEndDate = new Date(transitionDate);
            preEndDate.setDate(preEndDate.getDate() - 1);
            periodEndDate = preEndDate.toISOString().split('T')[0];
          }
        }
      }
    }
    
    const result = await query(
      `INSERT INTO goals (id, employee_id, cycle_id, kra_id, kpi_template_id, title, description, goal_type, metric_type, target_value, weight, calibration, due_date, status, quarter, period_type, transition_id, period_start_date, period_end_date, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::period_type, $16, $17, $18, NOW(), NOW())
       RETURNING *`,
      [
        employee_id ?? null,
        cycle_id ?? null,
        kra_id ?? null,
        kpi_template_id ?? null,
        title ?? null,
        description ?? null,
        goal_type || 'kpi',
        metric_type || 'number',
        target_value ?? null,
        weight ?? null,
        calibrationJson,
        due_date ?? null,
        status || 'draft',
        quarter ?? null,
        periodType,
        transitionId,
        periodStartDate,
        periodEndDate
      ]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/goals/:id
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { kra_id, title, description, goal_type, metric_type, target_value, weight, due_date, status, manager_comments, calibration } = req.body;
    
    // Check current goal status - calibration can only be edited until manager approval
    const currentGoal = await query('SELECT status FROM goals WHERE id = $1', [req.params.id]);
    if (currentGoal.rows.length === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    
    const currentStatus = currentGoal.rows[0].status;
    const isLocked = currentStatus === 'approved' || currentStatus === 'locked';
    
    // Validate and format calibration if provided
    let calibrationJson = undefined;
    if (calibration !== undefined) {
      if (isLocked) {
        return res.status(403).json({ error: 'Calibration cannot be modified after manager approval' });
      }
      
      if (calibration === null) {
        calibrationJson = null;
      } else if (Array.isArray(calibration)) {
        calibrationJson = JSON.stringify(calibration);
      } else if (typeof calibration === 'string') {
        // Already JSON string, validate it
        JSON.parse(calibration);
        calibrationJson = calibration;
      }
    }
    
    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    if (kra_id !== undefined) {
      updates.push(`kra_id = $${paramIndex++}`);
      values.push(kra_id ?? null);
    }
    if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(title ?? null);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description ?? null);
    }
    if (goal_type !== undefined) {
      updates.push(`goal_type = $${paramIndex++}`);
      values.push(goal_type ?? null);
    }
    if (metric_type !== undefined) {
      updates.push(`metric_type = $${paramIndex++}`);
      values.push(metric_type ?? null);
    }
    if (target_value !== undefined) {
      updates.push(`target_value = $${paramIndex++}`);
      values.push(target_value ?? null);
    }
    if (weight !== undefined) {
      updates.push(`weight = $${paramIndex++}`);
      values.push(weight ?? null);
    }
    if (calibrationJson !== undefined) {
      updates.push(`calibration = $${paramIndex++}`);
      values.push(calibrationJson);
    }
    if (due_date !== undefined) {
      updates.push(`due_date = $${paramIndex++}`);
      values.push(due_date ?? null);
    }
    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(status ?? null);
    }
    if (manager_comments !== undefined) {
      updates.push(`manager_comments = $${paramIndex++}`);
      values.push(manager_comments ?? null);
    }
    
    updates.push(`updated_at = NOW()`);
    values.push(req.params.id);
    
    if (updates.length === 1) { // Only updated_at
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    const result = await query(
      `UPDATE goals SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/goals/:id/submit
router.post('/:id/submit', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      `UPDATE goals SET status = 'submitted', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/goals/:id/approve
router.post('/:id/approve', authMiddleware, async (req, res) => {
  try {
    // Get goal details
    const goalResult = await query(
      'SELECT employee_id, cycle_id, quarter FROM goals WHERE id = $1',
      [req.params.id]
    );
    
    if (goalResult.rows.length === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    
    const goal = goalResult.rows[0];
    
    // Check if user is manager or delegate
    const auth = await checkManagerOrDelegate(
      req.user.userId,
      goal.employee_id,
      goal.cycle_id,
      goal.quarter
    );
    
    if (!auth.isAuthorized) {
      return res.status(403).json({ error: 'Not authorized to approve this goal' });
    }
    
    const result = await query(
      `UPDATE goals SET status = 'approved', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/goals/:id/return
router.post('/:id/return', authMiddleware, async (req, res) => {
  try {
    const { comments } = req.body;
    
    // Get goal details
    const goalResult = await query(
      'SELECT employee_id, cycle_id, quarter FROM goals WHERE id = $1',
      [req.params.id]
    );
    
    if (goalResult.rows.length === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    
    const goal = goalResult.rows[0];
    
    // Check if user is manager or delegate
    const auth = await checkManagerOrDelegate(
      req.user.userId,
      goal.employee_id,
      goal.cycle_id,
      goal.quarter
    );
    
    if (!auth.isAuthorized) {
      return res.status(403).json({ error: 'Not authorized to return this goal' });
    }
    
    const result = await query(
      `UPDATE goals SET status = 'returned', manager_comments = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [comments || null, req.params.id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/goals/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM goals WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    res.json({ message: 'Goal deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/goals/:id/revoke - Revoke (delete) approved goal/KPI
router.post('/:id/revoke', authMiddleware, async (req, res) => {
  try {
    // Get goal details including employee_id, cycle_id, quarter, and status
    const goalResult = await query(
      'SELECT employee_id, cycle_id, quarter, status FROM goals WHERE id = $1',
      [req.params.id]
    );
    
    if (goalResult.rows.length === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    
    const goal = goalResult.rows[0];
    
    // Only allow revoking approved goals
    if (goal.status !== 'approved') {
      return res.status(400).json({ error: 'Only approved goals can be revoked' });
    }
    
    // Check if user is manager or delegate
    const auth = await checkManagerOrDelegate(
      req.user.userId,
      goal.employee_id,
      goal.cycle_id,
      goal.quarter
    );
    
    if (!auth.isAuthorized) {
      return res.status(403).json({ error: 'Not authorized to revoke this goal' });
    }
    
    // Delete the goal
    const result = await query(
      'DELETE FROM goals WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    
    res.json({ message: 'Approved goal revoked and deleted successfully' });
  } catch (error) {
    console.error('Revoke goal error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== GOAL SELF RATINGS ==========

// GET /api/goals/self-ratings
router.get('/self-ratings', authMiddleware, async (req, res) => {
  try {
    const { self_evaluation_id, goal_id } = req.query;
    
    let sql = 'SELECT * FROM goal_self_ratings WHERE 1=1';
    const params = [];
    let idx = 1;

    if (self_evaluation_id) {
      sql += ` AND self_evaluation_id = $${idx++}`;
      params.push(self_evaluation_id);
    }
    if (goal_id) {
      sql += ` AND goal_id = $${idx++}`;
      params.push(goal_id);
    }

    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/goals/self-ratings
router.post('/self-ratings', authMiddleware, async (req, res) => {
  try {
    const { self_evaluation_id, goal_id, self_rating, achievement, evidence } = req.body;
    
    const result = await query(
      `INSERT INTO goal_self_ratings (id, self_evaluation_id, goal_id, self_rating, achievement, evidence, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (self_evaluation_id, goal_id) DO UPDATE SET
         self_rating = EXCLUDED.self_rating,
         achievement = EXCLUDED.achievement,
         evidence = EXCLUDED.evidence,
         updated_at = NOW()
       RETURNING *`,
      [self_evaluation_id, goal_id, self_rating, achievement, evidence]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== GOAL MANAGER RATINGS ==========

// GET /api/goals/manager-ratings
router.get('/manager-ratings', authMiddleware, async (req, res) => {
  try {
    const { manager_evaluation_id, goal_id } = req.query;
    
    let sql = 'SELECT * FROM goal_manager_ratings WHERE 1=1';
    const params = [];
    let idx = 1;

    if (manager_evaluation_id) {
      sql += ` AND manager_evaluation_id = $${idx++}`;
      params.push(manager_evaluation_id);
    }
    if (goal_id) {
      sql += ` AND goal_id = $${idx++}`;
      params.push(goal_id);
    }

    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/goals/manager-ratings
router.post('/manager-ratings', authMiddleware, async (req, res) => {
  try {
    const { manager_evaluation_id, goal_id, rating, comments } = req.body;
    
    const result = await query(
      `INSERT INTO goal_manager_ratings (id, manager_evaluation_id, goal_id, rating, comments, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (manager_evaluation_id, goal_id) DO UPDATE SET
         rating = EXCLUDED.rating,
         comments = EXCLUDED.comments,
         updated_at = NOW()
       RETURNING *`,
      [manager_evaluation_id, goal_id, rating, comments]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

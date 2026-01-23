import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// GET /api/goals - Get goals with filters
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, status, type, quarter } = req.query;
    
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

// GET /api/goals/pending-approvals - For managers
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
    
    const managerCode = empResult.rows[0].emp_code;
    
    let sql = `
      SELECT g.*, e.full_name, e.email 
      FROM goals g
      JOIN employees e ON g.employee_id = e.id
      WHERE e.manager_code = $1 AND g.status = 'submitted'
    `;
    const params = [managerCode];
    let idx = 2;
    
    if (cycle_id) {
      sql += ` AND g.cycle_id = $${idx++}`;
      params.push(cycle_id);
    }
    if (quarter) {
      sql += ` AND g.quarter = $${idx++}`;
      params.push(parseInt(quarter));
    }
    
    const result = await query(sql, params);
    res.json({ data: result.rows, count: result.rows.length });
  } catch (error) {
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
    const { employee_id, cycle_id, kra_id, kpi_template_id, goal_type, title, description, weight, target_value, metric_type, due_date, status, calibration, quarter } = req.body;
    
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
    
    const result = await query(
      `INSERT INTO goals (id, employee_id, cycle_id, kra_id, kpi_template_id, title, description, goal_type, metric_type, target_value, weight, calibration, due_date, status, quarter, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
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
        quarter ?? null
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
    const result = await query(
      `UPDATE goals SET status = 'approved', updated_at = NOW() WHERE id = $1 RETURNING *`,
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

// POST /api/goals/:id/return
router.post('/:id/return', authMiddleware, async (req, res) => {
  try {
    const { comments } = req.body;
    const result = await query(
      `UPDATE goals SET status = 'returned', updated_at = NOW() WHERE id = $1 RETURNING *`,
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

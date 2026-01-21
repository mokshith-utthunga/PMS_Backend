import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// GET /api/goals - Get goals with filters
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, status, type, quarter, kra_id } = req.query;
    
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
    if (kra_id) {
      sql += ` AND kra_id = $${idx++}`;
      params.push(kra_id);
    }
    // Only filter by quarter when a valid quarter number (1-4) is provided
    // quarter=null or quarter=undefined means "no quarter filter" (backward compatible)
    if (quarter !== undefined && quarter !== 'null' && quarter !== null && quarter !== '') {
      const quarterNum = parseInt(quarter);
      if (quarterNum >= 1 && quarterNum <= 4) {
        sql += ` AND quarter = $${idx++}`;
        params.push(quarterNum);
      }
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
    const { cycle_id } = req.query;
    
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
    
    if (cycle_id) {
      sql += ' AND cycle_id = $2';
      params.push(cycle_id);
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
    const { cycle_id } = req.query;
    
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
    
    if (cycle_id) {
      sql += ' AND g.cycle_id = $2';
      params.push(cycle_id);
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
    const { employee_id, cycle_id, kra_id, goal_type, title, description, weight, target_value, metric_type, due_date, status, quarter } = req.body;
    
    const result = await query(
      `INSERT INTO goals (id, employee_id, cycle_id, kra_id, title, description, goal_type, metric_type, target_value, weight, due_date, status, quarter, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
       RETURNING *`,
      [
        employee_id ?? null,
        cycle_id ?? null,
        kra_id ?? null,
        title ?? null,
        description ?? null,
        goal_type || 'kpi',
        metric_type || 'number',
        target_value ?? null,
        weight ?? null,
        due_date ?? null,
        status || 'draft',
        quarter || null
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
    const { kra_id, title, description, goal_type, metric_type, target_value, weight, due_date, status, manager_comments, quarter } = req.body;
    
    const result = await query(
      `UPDATE goals SET
        kra_id = COALESCE($1, kra_id),
        title = COALESCE($2, title),
        description = COALESCE($3, description),
        goal_type = COALESCE($4, goal_type),
        metric_type = COALESCE($5, metric_type),
        target_value = COALESCE($6, target_value),
        weight = COALESCE($7, weight),
        due_date = COALESCE($8, due_date),
        status = COALESCE($9, status),
        manager_comments = COALESCE($10, manager_comments),
        quarter = COALESCE($11, quarter),
        updated_at = NOW()
       WHERE id = $12 RETURNING *`,
      [
        kra_id ?? null,
        title ?? null,
        description ?? null,
        goal_type ?? null,
        metric_type ?? null,
        target_value ?? null,
        weight ?? null,
        due_date ?? null,
        status ?? null,
        manager_comments ?? null,
        quarter !== undefined ? (quarter || null) : undefined,
        req.params.id
      ]
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

// POST /api/goals/clone - Clone goals from one quarter to another
router.post('/clone', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, source_quarter, target_quarter } = req.body;
    
    if (!employee_id || !cycle_id || !source_quarter || !target_quarter) {
      return res.status(400).json({ error: 'employee_id, cycle_id, source_quarter, and target_quarter are required' });
    }
    
    if (source_quarter === target_quarter) {
      return res.status(400).json({ error: 'Source and target quarters must be different' });
    }
    
    // Get source KRAs and KPIs
    const sourceKrasResult = await query(
      'SELECT * FROM kras WHERE employee_id = $1 AND cycle_id = $2 AND quarter = $3',
      [employee_id, cycle_id, source_quarter]
    );
    
    const sourceKpisResult = await query(
      'SELECT * FROM goals WHERE employee_id = $1 AND cycle_id = $2 AND quarter = $3 AND kra_id IS NOT NULL',
      [employee_id, cycle_id, source_quarter]
    );
    
    const sourceKras = sourceKrasResult.rows;
    const sourceKpis = sourceKpisResult.rows;
    
    if (sourceKras.length === 0) {
      return res.status(404).json({ error: 'No KRAs found for source quarter' });
    }
    
    // Create a map of old KRA IDs to new KRA IDs
    const kraIdMap = new Map();
    const clonedKras = [];
    
    // Clone KRAs
    for (const kra of sourceKras) {
      const newKraResult = await query(
        `INSERT INTO kras (id, employee_id, cycle_id, title, description, weight, status, quarter, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         RETURNING *`,
        [employee_id, cycle_id, kra.title, kra.description, kra.weight, 'draft', target_quarter]
      );
      const newKra = newKraResult.rows[0];
      kraIdMap.set(kra.id, newKra.id);
      clonedKras.push(newKra);
    }
    
    // Clone KPIs
    const clonedKpis = [];
    for (const kpi of sourceKpis) {
      const newKraId = kraIdMap.get(kpi.kra_id);
      if (newKraId) {
        const newKpiResult = await query(
          `INSERT INTO goals (id, employee_id, cycle_id, kra_id, title, description, goal_type, metric_type, target_value, weight, due_date, status, quarter, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
           RETURNING *`,
          [
            employee_id,
            cycle_id,
            newKraId,
            kpi.title,
            kpi.description,
            kpi.goal_type,
            kpi.metric_type,
            kpi.target_value,
            kpi.weight,
            kpi.due_date,
            'draft',
            target_quarter
          ]
        );
        clonedKpis.push(newKpiResult.rows[0]);
      }
    }
    
    res.status(201).json({
      data: {
        kras: clonedKras,
        kpis: clonedKpis
      },
      message: `Cloned ${clonedKras.length} KRAs and ${clonedKpis.length} KPIs from Q${source_quarter} to Q${target_quarter}`
    });
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

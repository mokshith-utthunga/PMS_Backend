import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// GET /api/bonus-kras - Get bonus KRAs for an employee in a cycle
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id } = req.query;
    
    let sql = 'SELECT * FROM bonus_kras WHERE 1=1';
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

    sql += ' ORDER BY created_at DESC';
    
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Get bonus KRAs error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/bonus-kras/:id - Get a single bonus KRA
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM bonus_kras WHERE id = $1',
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bonus KRA not found' });
    }
    
    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Get single bonus KRA error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/bonus-kras - Create a new bonus KRA
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, title, description, status, manager_comments } = req.body;
    
    const result = await query(
      `INSERT INTO bonus_kras (employee_id, cycle_id, title, description, status, manager_comments)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [employee_id, cycle_id, title, description, status || 'draft', manager_comments]
    );
    
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    console.error('Create bonus KRA error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/bonus-kras/:id - Update a bonus KRA
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { title, description, status, manager_comments } = req.body;
    
    const result = await query(
      `UPDATE bonus_kras 
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           status = COALESCE($3, status),
           manager_comments = COALESCE($4, manager_comments),
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [title ?? null, description ?? null, status ?? null, manager_comments ?? null, req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bonus KRA not found' });
    }
    
    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Update bonus KRA error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/bonus-kras/:id - Delete a bonus KRA
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM bonus_kras WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bonus KRA not found' });
    }
    
    res.json({ message: 'Bonus KRA deleted' });
  } catch (error) {
    console.error('Delete bonus KRA error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/bonus-kras/:kraId/kpis - Get KPIs for a bonus KRA
router.get('/:kraId/kpis', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM bonus_kpis WHERE bonus_kra_id = $1 ORDER BY created_at ASC',
      [req.params.kraId]
    );
    
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Get bonus KPIs error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/bonus-kras/:kraId/kpis - Create a KPI for a bonus KRA
router.post('/:kraId/kpis', authMiddleware, async (req, res) => {
  try {
    const { title, description, metric_type, target_value, due_date, status, manager_comments } = req.body;
    
    const result = await query(
      `INSERT INTO bonus_kpis (bonus_kra_id, title, description, metric_type, target_value, due_date, status, manager_comments)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [req.params.kraId, title, description, metric_type || 'number', target_value, due_date, status || 'draft', manager_comments]
    );
    
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    console.error('Create bonus KPI error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

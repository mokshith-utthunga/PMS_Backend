import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = express.Router();

// ============================================================
// EMPLOYEES
// ============================================================

// GET /api/data/employees/me - Get current user's employee record
router.get('/employees/me', authMiddleware, async (req, res) => {
  try {
    const result = await query('SELECT * FROM employees WHERE profile_id = $1', [req.user.userId]);
    res.json({ data: result.rows[0] || null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/data/employees - Get employees with filters
router.get('/employees', authMiddleware, async (req, res) => {
  try {
    const { manager_code, status, department, id, user_id, profile_id, emp_code, manager_id, emp_id } = req.query;
    let sql = 'SELECT * FROM employees WHERE 1=1';
    const params = [];
    let idx = 1;

    if (id) { sql += ` AND id = $${idx++}`; params.push(id); }
    // Support both old (user_id) and new (profile_id) parameter names for backward compatibility
    const profileIdValue = profile_id || user_id;
    if (profileIdValue) { sql += ` AND profile_id = $${idx++}`; params.push(profileIdValue); }
    // Support both old (emp_id) and new (emp_code) parameter names for backward compatibility
    const empCodeValue = emp_code || emp_id;
    if (empCodeValue) { sql += ` AND emp_code = $${idx++}`; params.push(empCodeValue); }
    // Support both old (manager_id) and new (manager_code) parameter names for backward compatibility
    const managerCodeValue = manager_code || manager_id;
    if (managerCodeValue) { sql += ` AND manager_code = $${idx++}`; params.push(managerCodeValue); }
    if (status) { sql += ` AND status = $${idx++}`; params.push(status); }
    if (department) { sql += ` AND department = $${idx++}`; params.push(department); }

    sql += ' ORDER BY full_name';
    const result = await query(sql, params);
    res.json({ data: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/data/employees - Create employee
router.post('/employees', authMiddleware, async (req, res) => {
  try {
    // Support both old (emp_id, manager_id, user_id, first_name, last_name) and new (emp_code, manager_code, profile_id, full_name) parameter names
    const emp_code = req.body.emp_code || req.body.emp_id;
    const manager_code = req.body.manager_code || req.body.manager_id;
    const profile_id = req.body.profile_id || req.body.user_id;
    // Support both full_name and first_name/last_name for backward compatibility
    const full_name = req.body.full_name || (req.body.first_name && req.body.last_name ? `${req.body.first_name} ${req.body.last_name}` : req.body.first_name || req.body.last_name || '');
    const { email, department, business_unit, grade, location, date_of_joining, status, sub_department } = req.body;
    const result = await query(
      `INSERT INTO employees (emp_code, full_name, email, department, business_unit, grade, location, date_of_joining, status, manager_code, profile_id, sub_department)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [emp_code, full_name, email, department, business_unit, grade, location, date_of_joining, status || 'active', manager_code, profile_id, sub_department]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/data/employees/:id - Update employee
router.put('/employees/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    
    const result = await query(
      `UPDATE employees SET ${setClause}, updated_at = NOW() WHERE id = $${keys.length + 1} RETURNING *`,
      [...values, id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// PERFORMANCE CYCLES
// ============================================================

// GET /api/data/cycles/active - Get active cycle
router.get('/cycles/active', authMiddleware, async (req, res) => {
  try {
    const result = await query("SELECT * FROM performance_cycles WHERE status = 'active' ORDER BY created_at DESC LIMIT 1");
    res.json({ data: result.rows[0] || null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/data/cycles - Get all cycles
router.get('/cycles', authMiddleware, async (req, res) => {
  try {
    const { status, id } = req.query;
    let sql = 'SELECT * FROM performance_cycles WHERE 1=1';
    const params = [];
    let idx = 1;

    if (id) { sql += ` AND id = $${idx++}`; params.push(id); }
    if (status) { sql += ` AND status = $${idx++}`; params.push(status); }

    sql += ' ORDER BY year DESC, created_at DESC';
    const result = await query(sql, params);
    res.json({ data: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/data/cycles - Create cycle
router.post('/cycles', authMiddleware, async (req, res) => {
  try {
    const fields = req.body;
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    
    const result = await query(
      `INSERT INTO performance_cycles (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/data/cycles/:id - Update cycle
router.put('/cycles/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    
    const result = await query(
      `UPDATE performance_cycles SET ${setClause}, updated_at = NOW() WHERE id = $${keys.length + 1} RETURNING *`,
      [...values, id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// KRAs
// ============================================================

// GET /api/data/kras - Get KRAs
router.get('/kras', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, id, status } = req.query;
    let sql = 'SELECT * FROM kras WHERE 1=1';
    const params = [];
    let idx = 1;

    if (id) { sql += ` AND id = $${idx++}`; params.push(id); }
    if (employee_id) { sql += ` AND employee_id = $${idx++}`; params.push(employee_id); }
    if (cycle_id) { sql += ` AND cycle_id = $${idx++}`; params.push(cycle_id); }
    if (status) { sql += ` AND status = $${idx++}`; params.push(status); }

    sql += ' ORDER BY created_at ASC';
    const result = await query(sql, params);
    res.json({ data: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/data/kras - Create KRA
router.post('/kras', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, title, description, weight, status } = req.body;
    const result = await query(
      `INSERT INTO kras (employee_id, cycle_id, title, description, weight, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [employee_id, cycle_id, title, description, weight, status || 'draft']
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/data/kras/:id - Update KRA
router.put('/kras/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    
    const result = await query(
      `UPDATE kras SET ${setClause}, updated_at = NOW() WHERE id = $${keys.length + 1} RETURNING *`,
      [...values, id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/data/kras/:id - Delete KRA
router.delete('/kras/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM kras WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// GOALS (KPIs)
// ============================================================

// GET /api/data/goals - Get goals
router.get('/goals', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, kra_id, id, status } = req.query;
    let sql = 'SELECT * FROM goals WHERE 1=1';
    const params = [];
    let idx = 1;

    if (id) { sql += ` AND id = $${idx++}`; params.push(id); }
    if (employee_id) { sql += ` AND employee_id = $${idx++}`; params.push(employee_id); }
    if (cycle_id) { sql += ` AND cycle_id = $${idx++}`; params.push(cycle_id); }
    if (kra_id) { sql += ` AND kra_id = $${idx++}`; params.push(kra_id); }
    if (status) { sql += ` AND status = $${idx++}`; params.push(status); }

    sql += ' ORDER BY created_at ASC';
    const result = await query(sql, params);
    res.json({ data: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/data/goals - Create goal
router.post('/goals', authMiddleware, async (req, res) => {
  try {
    const fields = req.body;
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    
    const result = await query(
      `INSERT INTO goals (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/data/goals/:id - Update goal
router.put('/goals/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    
    const result = await query(
      `UPDATE goals SET ${setClause}, updated_at = NOW() WHERE id = $${keys.length + 1} RETURNING *`,
      [...values, id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/data/goals/:id - Delete goal
router.delete('/goals/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM goals WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// BONUS KRAs
// ============================================================

// GET /api/data/bonus-kras
router.get('/bonus-kras', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, id } = req.query;
    let sql = 'SELECT * FROM bonus_kras WHERE 1=1';
    const params = [];
    let idx = 1;

    if (id) { sql += ` AND id = $${idx++}`; params.push(id); }
    if (employee_id) { sql += ` AND employee_id = $${idx++}`; params.push(employee_id); }
    if (cycle_id) { sql += ` AND cycle_id = $${idx++}`; params.push(cycle_id); }

    sql += ' ORDER BY created_at ASC';
    const result = await query(sql, params);
    res.json({ data: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/data/bonus-kras
router.post('/bonus-kras', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, title, description, status } = req.body;
    const result = await query(
      `INSERT INTO bonus_kras (employee_id, cycle_id, title, description, status)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [employee_id, cycle_id, title, description, status || 'draft']
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/data/bonus-kras/:id
router.put('/bonus-kras/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    
    const result = await query(
      `UPDATE bonus_kras SET ${setClause}, updated_at = NOW() WHERE id = $${keys.length + 1} RETURNING *`,
      [...values, id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/data/bonus-kras/:id
router.delete('/bonus-kras/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM bonus_kras WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// BONUS KPIs
// ============================================================

// GET /api/data/bonus-kpis
router.get('/bonus-kpis', authMiddleware, async (req, res) => {
  try {
    const { bonus_kra_id, id } = req.query;
    let sql = 'SELECT * FROM bonus_kpis WHERE 1=1';
    const params = [];
    let idx = 1;

    if (id) { sql += ` AND id = $${idx++}`; params.push(id); }
    if (bonus_kra_id) { sql += ` AND bonus_kra_id = $${idx++}`; params.push(bonus_kra_id); }

    sql += ' ORDER BY created_at ASC';
    const result = await query(sql, params);
    res.json({ data: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/data/bonus-kpis
router.post('/bonus-kpis', authMiddleware, async (req, res) => {
  try {
    const fields = req.body;
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    
    const result = await query(
      `INSERT INTO bonus_kpis (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/data/bonus-kpis/:id
router.put('/bonus-kpis/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    
    const result = await query(
      `UPDATE bonus_kpis SET ${setClause}, updated_at = NOW() WHERE id = $${keys.length + 1} RETURNING *`,
      [...values, id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/data/bonus-kpis/:id
router.delete('/bonus-kpis/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM bonus_kpis WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// SELF EVALUATIONS
// ============================================================

// GET /api/data/self-evaluations
router.get('/self-evaluations', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, id, quarter } = req.query;
    let sql = 'SELECT * FROM self_evaluations WHERE 1=1';
    const params = [];
    let idx = 1;

    if (id) { sql += ` AND id = $${idx++}`; params.push(id); }
    if (employee_id) { sql += ` AND employee_id = $${idx++}`; params.push(employee_id); }
    if (cycle_id) { sql += ` AND cycle_id = $${idx++}`; params.push(cycle_id); }
    if (quarter !== undefined) {
      if (quarter === 'null') {
        sql += ' AND quarter IS NULL';
      } else {
        sql += ` AND quarter = $${idx++}`; params.push(quarter);
      }
    }

    sql += ' ORDER BY created_at DESC';
    const result = await query(sql, params);
    res.json({ data: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/data/self-evaluations
router.post('/self-evaluations', authMiddleware, async (req, res) => {
  try {
    const fields = req.body;
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    
    const result = await query(
      `INSERT INTO self_evaluations (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/data/self-evaluations/:id
router.put('/self-evaluations/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    
    const result = await query(
      `UPDATE self_evaluations SET ${setClause}, updated_at = NOW() WHERE id = $${keys.length + 1} RETURNING *`,
      [...values, id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// MANAGER EVALUATIONS
// ============================================================

// GET /api/data/manager-evaluations
router.get('/manager-evaluations', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, id, evaluator_id, status } = req.query;
    let sql = 'SELECT * FROM manager_evaluations WHERE 1=1';
    const params = [];
    let idx = 1;

    if (id) { sql += ` AND id = $${idx++}`; params.push(id); }
    if (employee_id) { sql += ` AND employee_id = $${idx++}`; params.push(employee_id); }
    if (cycle_id) { sql += ` AND cycle_id = $${idx++}`; params.push(cycle_id); }
    if (evaluator_id) { sql += ` AND evaluator_id = $${idx++}`; params.push(evaluator_id); }
    if (status) { sql += ` AND status = $${idx++}`; params.push(status); }

    sql += ' ORDER BY created_at DESC';
    const result = await query(sql, params);
    res.json({ data: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/data/manager-evaluations
router.post('/manager-evaluations', authMiddleware, async (req, res) => {
  try {
    const fields = req.body;
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    
    const result = await query(
      `INSERT INTO manager_evaluations (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/data/manager-evaluations/:id
router.put('/manager-evaluations/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    
    const result = await query(
      `UPDATE manager_evaluations SET ${setClause}, updated_at = NOW() WHERE id = $${keys.length + 1} RETURNING *`,
      [...values, id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// GOAL RATINGS (Self and Manager)
// ============================================================

// GET /api/data/goal-self-ratings
router.get('/goal-self-ratings', authMiddleware, async (req, res) => {
  try {
    const { self_evaluation_id, goal_id } = req.query;
    let sql = 'SELECT * FROM goal_self_ratings WHERE 1=1';
    const params = [];
    let idx = 1;

    if (self_evaluation_id) { sql += ` AND self_evaluation_id = $${idx++}`; params.push(self_evaluation_id); }
    if (goal_id) { sql += ` AND goal_id = $${idx++}`; params.push(goal_id); }

    const result = await query(sql, params);
    res.json({ data: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/data/goal-self-ratings
router.post('/goal-self-ratings', authMiddleware, async (req, res) => {
  try {
    const fields = req.body;
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    
    const result = await query(
      `INSERT INTO goal_self_ratings (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/data/goal-self-ratings/:id
router.put('/goal-self-ratings/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    
    const result = await query(
      `UPDATE goal_self_ratings SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
      [...values, id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/data/goal-manager-ratings
router.get('/goal-manager-ratings', authMiddleware, async (req, res) => {
  try {
    const { manager_evaluation_id, goal_id } = req.query;
    let sql = 'SELECT * FROM goal_manager_ratings WHERE 1=1';
    const params = [];
    let idx = 1;

    if (manager_evaluation_id) { sql += ` AND manager_evaluation_id = $${idx++}`; params.push(manager_evaluation_id); }
    if (goal_id) { sql += ` AND goal_id = $${idx++}`; params.push(goal_id); }

    const result = await query(sql, params);
    res.json({ data: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/data/goal-manager-ratings
router.post('/goal-manager-ratings', authMiddleware, async (req, res) => {
  try {
    const fields = req.body;
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    
    const result = await query(
      `INSERT INTO goal_manager_ratings (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/data/goal-manager-ratings/:id
router.put('/goal-manager-ratings/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    
    const result = await query(
      `UPDATE goal_manager_ratings SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
      [...values, id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// NOTIFICATIONS
// ============================================================

// GET /api/data/notifications
router.get('/notifications', authMiddleware, async (req, res) => {
  try {
    const { user_id, is_read } = req.query;
    let sql = 'SELECT * FROM notifications WHERE 1=1';
    const params = [];
    let idx = 1;

    if (user_id) { sql += ` AND user_id = $${idx++}`; params.push(user_id); }
    if (is_read !== undefined) { sql += ` AND is_read = $${idx++}`; params.push(is_read === 'true'); }

    sql += ' ORDER BY created_at DESC LIMIT 50';
    const result = await query(sql, params);
    res.json({ data: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/data/notifications
router.post('/notifications', authMiddleware, async (req, res) => {
  try {
    const { user_id, title, message, type, link } = req.body;
    const result = await query(
      `INSERT INTO notifications (user_id, title, message, type, link, is_read)
       VALUES ($1, $2, $3, $4, $5, false) RETURNING *`,
      [user_id, title, message, type, link]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/data/notifications/:id
router.put('/notifications/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_read } = req.body;
    const result = await query(
      'UPDATE notifications SET is_read = $1 WHERE id = $2 RETURNING *',
      [is_read, id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/data/notifications/mark-all-read - Mark all as read
router.put('/notifications/mark-all-read', authMiddleware, async (req, res) => {
  try {
    await query('UPDATE notifications SET is_read = true WHERE user_id = $1', [req.user.userId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// RATING SCALES
// ============================================================

// GET /api/data/rating-scales
router.get('/rating-scales', authMiddleware, async (req, res) => {
  try {
    const { is_default } = req.query;
    let sql = 'SELECT * FROM rating_scales WHERE 1=1';
    const params = [];
    let idx = 1;

    if (is_default !== undefined) { sql += ` AND is_default = $${idx++}`; params.push(is_default === 'true'); }

    sql += ' ORDER BY value ASC';
    const result = await query(sql, params);
    res.json({ data: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// MASTER DATA (Departments, Grades, Locations, Business Units)
// ============================================================

// GET /api/data/departments
router.get('/departments', authMiddleware, async (req, res) => {
  try {
    const result = await query('SELECT * FROM departments ORDER BY name');
    res.json({ data: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/data/departments
router.post('/departments', authMiddleware, async (req, res) => {
  try {
    const { name, code, description } = req.body;
    const result = await query(
      'INSERT INTO departments (name, code, description) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET code = $2, description = $3 RETURNING *',
      [name, code, description]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/data/departments/:id
router.put('/departments/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, description } = req.body;
    const result = await query(
      'UPDATE departments SET name = $1, code = $2, description = $3, updated_at = NOW() WHERE id = $4 RETURNING *',
      [name, code, description, id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/data/departments/:id
router.delete('/departments/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM departments WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/data/grades
router.get('/grades', authMiddleware, async (req, res) => {
  try {
    const result = await query('SELECT * FROM grades ORDER BY level, name');
    res.json({ data: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/data/grades
router.post('/grades', authMiddleware, async (req, res) => {
  try {
    const { name, level } = req.body;
    const result = await query(
      'INSERT INTO grades (name, level) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET level = $2 RETURNING *',
      [name, level]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/data/grades/:id
router.put('/grades/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, level } = req.body;
    const result = await query(
      'UPDATE grades SET name = $1, level = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
      [name, level, id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/data/grades/:id
router.delete('/grades/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM grades WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/data/locations
router.get('/locations', authMiddleware, async (req, res) => {
  try {
    const result = await query('SELECT * FROM locations ORDER BY name');
    res.json({ data: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/data/locations
router.post('/locations', authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    const result = await query(
      'INSERT INTO locations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING *',
      [name]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/data/locations/:id
router.put('/locations/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const result = await query(
      'UPDATE locations SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [name, id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/data/locations/:id
router.delete('/locations/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM locations WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/data/business-units
router.get('/business-units', authMiddleware, async (req, res) => {
  try {
    const result = await query('SELECT * FROM business_units ORDER BY name');
    res.json({ data: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/data/business-units
router.post('/business-units', authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    const result = await query(
      'INSERT INTO business_units (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING *',
      [name]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/data/competencies
router.get('/competencies', authMiddleware, async (req, res) => {
  try {
    const { is_active } = req.query;
    let sql = 'SELECT * FROM competencies WHERE 1=1';
    const params = [];
    let idx = 1;

    if (is_active !== undefined) { sql += ` AND is_active = $${idx++}`; params.push(is_active === 'true'); }

    sql += ' ORDER BY name';
    const result = await query(sql, params);
    res.json({ data: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/data/competencies
router.post('/competencies', authMiddleware, async (req, res) => {
  try {
    const { name, description, category, is_active } = req.body;
    const result = await query(
      'INSERT INTO competencies (name, description, category, is_active) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, description, category, is_active ?? true]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/data/competencies/:id
router.put('/competencies/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    
    const result = await query(
      `UPDATE competencies SET ${setClause}, updated_at = NOW() WHERE id = $${keys.length + 1} RETURNING *`,
      [...values, id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/data/competencies/:id
router.delete('/competencies/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM competencies WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// USER ROLES (now stored in profiles table)
// ============================================================

// GET /api/data/user-roles (backward compatible endpoint)
router.get('/user-roles', authMiddleware, async (req, res) => {
  try {
    const { user_id } = req.query;
    let sql = 'SELECT id, user_id, role, created_at FROM profiles WHERE 1=1';
    const params = [];
    let idx = 1;

    if (user_id) { sql += ` AND id = $${idx++}`; params.push(user_id); }

    // Return in format compatible with old user_roles structure
    const result = await query(sql, params);
    const formattedRows = result.rows.map(row => ({
      id: row.id,
      user_id: row.id,
      role: row.role,
      created_at: row.created_at
    }));
    res.json({ data: formattedRows, count: formattedRows.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/data/user-roles (backward compatible endpoint)
router.post('/user-roles', authMiddleware, async (req, res) => {
  try {
    const { user_id, role } = req.body;
    const result = await query(
      'UPDATE profiles SET role = $2 WHERE id = $1 RETURNING id, role, created_at',
      [user_id, role]
    );
    // Return in format compatible with old user_roles structure
    const formattedRow = {
      id: result.rows[0].id,
      user_id: result.rows[0].id,
      role: result.rows[0].role,
      created_at: result.rows[0].created_at
    };
    res.status(201).json({ data: formattedRow });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/data/user-roles (backward compatible endpoint - sets role to default)
router.delete('/user-roles', authMiddleware, async (req, res) => {
  try {
    const { user_id, role } = req.query;
    // Set role back to default 'employee' instead of deleting
    await query('UPDATE profiles SET role = $2 WHERE id = $1', [user_id, 'employee']);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// KRA TEMPLATES
// ============================================================

// GET /api/data/kra-templates
router.get('/kra-templates', authMiddleware, async (req, res) => {
  try {
    const { department, grade, is_active, id } = req.query;
    let sql = 'SELECT * FROM kra_templates WHERE 1=1';
    const params = [];
    let idx = 1;

    if (id) { sql += ` AND id = $${idx++}`; params.push(id); }
    if (department) { sql += ` AND department = $${idx++}`; params.push(department); }
    if (grade) { sql += ` AND grade = $${idx++}`; params.push(grade); }
    if (is_active !== undefined) { sql += ` AND is_active = $${idx++}`; params.push(is_active === 'true'); }

    sql += ' ORDER BY title';
    const result = await query(sql, params);
    res.json({ data: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/data/kra-templates
router.post('/kra-templates', authMiddleware, async (req, res) => {
  try {
    const fields = req.body;
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    
    const result = await query(
      `INSERT INTO kra_templates (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/data/kra-templates/:id
router.put('/kra-templates/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    
    const result = await query(
      `UPDATE kra_templates SET ${setClause}, updated_at = NOW() WHERE id = $${keys.length + 1} RETURNING *`,
      [...values, id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/data/kra-templates/:id
router.delete('/kra-templates/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM kra_templates WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/data/kpi-templates
router.get('/kpi-templates', authMiddleware, async (req, res) => {
  try {
    const { kra_template_id } = req.query;
    let sql = 'SELECT * FROM kpi_templates WHERE 1=1';
    const params = [];
    let idx = 1;

    if (kra_template_id) { sql += ` AND kra_template_id = $${idx++}`; params.push(kra_template_id); }

    sql += ' ORDER BY title';
    const result = await query(sql, params);
    res.json({ data: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/data/kpi-templates
router.post('/kpi-templates', authMiddleware, async (req, res) => {
  try {
    const fields = req.body;
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    
    const result = await query(
      `INSERT INTO kpi_templates (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/data/kpi-templates/:id
router.delete('/kpi-templates/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM kpi_templates WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// CALIBRATION
// ============================================================

// GET /api/data/calibration-groups
router.get('/calibration-groups', authMiddleware, async (req, res) => {
  try {
    const { cycle_id, id, status } = req.query;
    let sql = 'SELECT * FROM calibration_groups WHERE 1=1';
    const params = [];
    let idx = 1;

    if (id) { sql += ` AND id = $${idx++}`; params.push(id); }
    if (cycle_id) { sql += ` AND cycle_id = $${idx++}`; params.push(cycle_id); }
    if (status) { sql += ` AND status = $${idx++}`; params.push(status); }

    sql += ' ORDER BY created_at DESC';
    const result = await query(sql, params);
    res.json({ data: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/data/calibration-groups
router.post('/calibration-groups', authMiddleware, async (req, res) => {
  try {
    const fields = req.body;
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    
    const result = await query(
      `INSERT INTO calibration_groups (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/data/calibration-groups/:id
router.put('/calibration-groups/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    
    const result = await query(
      `UPDATE calibration_groups SET ${setClause}, updated_at = NOW() WHERE id = $${keys.length + 1} RETURNING *`,
      [...values, id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/data/calibration-groups/:id
router.delete('/calibration-groups/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM calibration_groups WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/data/calibration-entries
router.get('/calibration-entries', authMiddleware, async (req, res) => {
  try {
    const { calibration_group_id } = req.query;
    let sql = `
      SELECT ce.*, e.emp_code, e.full_name, e.department, e.grade
      FROM calibration_entries ce
      JOIN employees e ON ce.employee_id = e.id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (calibration_group_id) { sql += ` AND ce.calibration_group_id = $${idx++}`; params.push(calibration_group_id); }

    sql += ' ORDER BY e.full_name';
    const result = await query(sql, params);
    res.json({ data: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/data/calibration-entries
router.post('/calibration-entries', authMiddleware, async (req, res) => {
  try {
    const fields = req.body;
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    
    const result = await query(
      `INSERT INTO calibration_entries (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/data/calibration-entries/:id
router.put('/calibration-entries/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    
    const result = await query(
      `UPDATE calibration_entries SET ${setClause}, updated_at = NOW() WHERE id = $${keys.length + 1} RETURNING *`,
      [...values, id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/data/calibration-settings
router.get('/calibration-settings', authMiddleware, async (req, res) => {
  try {
    const result = await query('SELECT * FROM calibration_settings ORDER BY id LIMIT 1');
    res.json({ data: result.rows[0] || null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/data/default-calibration-quotas
router.get('/default-calibration-quotas', authMiddleware, async (req, res) => {
  try {
    const result = await query('SELECT * FROM default_calibration_quotas ORDER BY rating_value');
    res.json({ data: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/data/department-calibration-quotas
router.get('/department-calibration-quotas', authMiddleware, async (req, res) => {
  try {
    const result = await query('SELECT * FROM department_calibration_quotas ORDER BY department, rating_value');
    res.json({ data: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// LATE SUBMISSION PERMISSIONS
// ============================================================

// GET /api/data/late-submission-permissions
// Restricted to HR Admin and System Admin
router.get('/late-submission-permissions', authMiddleware, requireRole(['hr_admin', 'system_admin']), async (req, res) => {
  try {
    const { cycle_id, employee_id, revoked_at } = req.query;
    let sql = 'SELECT * FROM late_submission_permissions WHERE 1=1';
    const params = [];
    let idx = 1;

    if (cycle_id) { sql += ` AND cycle_id = $${idx++}`; params.push(cycle_id); }
    if (employee_id) { sql += ` AND employee_id = $${idx++}`; params.push(employee_id); }
    if (revoked_at === 'null') { sql += ' AND revoked_at IS NULL'; }

    sql += ' ORDER BY granted_at DESC';
    const result = await query(sql, params);
    res.json({ data: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/data/late-submission-permissions
// Restricted to HR Admin and System Admin
router.post('/late-submission-permissions', authMiddleware, requireRole(['hr_admin', 'system_admin']), async (req, res) => {
  try {
    const { cycle_id, employee_id, granted_by, reason } = req.body;
    const result = await query(
      `INSERT INTO late_submission_permissions (cycle_id, employee_id, granted_by, reason, granted_at)
       VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
      [cycle_id, employee_id, granted_by, reason]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/data/late-submission-permissions/:id/revoke
// Restricted to HR Admin and System Admin
router.put('/late-submission-permissions/:id/revoke', authMiddleware, requireRole(['hr_admin', 'system_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      'UPDATE late_submission_permissions SET revoked_at = NOW() WHERE id = $1 RETURNING *',
      [id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// USERS / PROFILES
// ============================================================

// GET /api/data/users
router.get('/users', authMiddleware, async (req, res) => {
  try {
    const result = await query('SELECT id, email, created_at FROM users ORDER BY email');
    res.json({ data: result.rows, count: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

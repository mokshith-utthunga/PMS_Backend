import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = express.Router();

// GET /api/kras - Get KRAs with filters
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, status, quarter } = req.query;
    
    let sql = 'SELECT * FROM kras WHERE 1=1';
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
    if (quarter) {
      sql += ` AND quarter = $${idx++}`;
      params.push(parseInt(quarter));
    }

    sql += ' ORDER BY created_at ASC';
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/kras/my - Get current user's KRAs
router.get('/my', authMiddleware, async (req, res) => {
  try {
    const { cycle_id, quarter } = req.query;
    
    const empResult = await query(
      'SELECT id FROM employees WHERE profile_id = $1',
      [req.user.userId]
    );
    
    if (empResult.rows.length === 0) {
      return res.json({ data: [] });
    }
    
    let sql = 'SELECT * FROM kras WHERE employee_id = $1';
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
    sql += ' ORDER BY created_at ASC';
    
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/kras
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, title, description, weight, status, quarter, kra_template_id } = req.body;
    
    const result = await query(
      `INSERT INTO kras (id, employee_id, cycle_id, kra_template_id, title, description, weight, status, quarter, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       RETURNING *`,
      [employee_id, cycle_id, kra_template_id || null, title, description, weight, status || 'draft', quarter || null]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/kras/:id
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { title, description, weight, status, quarter } = req.body;
    
    const result = await query(
      `UPDATE kras SET
        title = COALESCE($1, title),
        description = $2,
        weight = COALESCE($3, weight),
        status = COALESCE($4, status),
        quarter = COALESCE($5, quarter),
        updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [
        title ?? null,
        description ?? null,
        weight ?? null,
        status ?? null,
        quarter ?? null,
        req.params.id
      ]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'KRA not found' });
    }
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/kras/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM kras WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'KRA not found' });
    }
    res.json({ message: 'KRA deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/kras/submit - Submit multiple KRAs
router.post('/submit', authMiddleware, async (req, res) => {
  try {
    const { kra_ids } = req.body;
    
    const result = await query(
      `UPDATE kras SET status = 'submitted', updated_at = NOW() 
       WHERE id = ANY($1) RETURNING *`,
      [kra_ids]
    );
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== BONUS KRAS ==========

// GET /api/kras/bonus
router.get('/bonus', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, status } = req.query;
    
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
    if (status) {
      sql += ` AND status = $${idx++}`;
      params.push(status);
    }

    sql += ' ORDER BY created_at ASC';
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/kras/bonus
router.post('/bonus', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, title, description, status } = req.body;
    
    const result = await query(
      `INSERT INTO bonus_kras (id, employee_id, cycle_id, title, description, status, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING *`,
      [employee_id, cycle_id, title, description, status || 'draft']
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/kras/bonus/:id
router.put('/bonus/:id', authMiddleware, async (req, res) => {
  try {
    const { title, description, status } = req.body;
    
    const result = await query(
      `UPDATE bonus_kras SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        status = COALESCE($3, status),
        updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [
        title ?? null,
        description ?? null,
        status ?? null,
        req.params.id
      ]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bonus KRA not found' });
    }
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/kras/bonus/:id
router.delete('/bonus/:id', authMiddleware, async (req, res) => {
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
    res.status(500).json({ error: error.message });
  }
});

// ========== BONUS KPIS ==========

// GET /api/kras/bonus-kpis
router.get('/bonus-kpis', authMiddleware, async (req, res) => {
  try {
    const { bonus_kra_id } = req.query;
    
    let sql = 'SELECT * FROM bonus_kpis WHERE 1=1';
    const params = [];
    let idx = 1;

    if (bonus_kra_id) {
      sql += ` AND bonus_kra_id = $${idx++}`;
      params.push(bonus_kra_id);
    }

    sql += ' ORDER BY created_at ASC';
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/kras/bonus-kpis
router.post('/bonus-kpis', authMiddleware, async (req, res) => {
  try {
    const { bonus_kra_id, title, description, metric_type, target_value, status } = req.body;
    
    const result = await query(
      `INSERT INTO bonus_kpis (id, bonus_kra_id, title, description, metric_type, target_value, status, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING *`,
      [bonus_kra_id, title, description, metric_type || 'number', target_value, status || 'draft']
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/kras/bonus-kpis/:id
router.put('/bonus-kpis/:id', authMiddleware, async (req, res) => {
  try {
    const { title, description, metric_type, target_value, status } = req.body;
    
    const result = await query(
      `UPDATE bonus_kpis SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        metric_type = COALESCE($3, metric_type),
        target_value = $4,
        status = COALESCE($5, status),
        updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [
        title ?? null,
        description ?? null,
        metric_type ?? null,
        target_value ?? null,
        status ?? null,
        req.params.id
      ]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bonus KPI not found' });
    }
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/kras/bonus-kpis/:id
router.delete('/bonus-kpis/:id', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM bonus_kpis WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bonus KPI not found' });
    }
    res.json({ message: 'Bonus KPI deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== KRA TEMPLATES ==========

// GET /api/kras/templates
router.get('/templates', authMiddleware, async (req, res) => {
  try {
    const { department, grade, is_active } = req.query;
    
    let sql = 'SELECT * FROM kra_templates WHERE 1=1';
    const params = [];
    let idx = 1;

    if (department) {
      sql += ` AND (department = $${idx++} OR department IS NULL)`;
      params.push(department);
    }
    if (grade) {
      sql += ` AND (grade = $${idx++} OR grade IS NULL)`;
      params.push(grade);
    }
    if (is_active !== undefined) {
      sql += ` AND is_active = $${idx++}`;
      params.push(is_active === 'true');
    }

    sql += ' ORDER BY title ASC';
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/kras/templates/:id/kpis
router.get('/templates/:id/kpis', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM kpi_templates WHERE kra_template_id = $1 ORDER BY title ASC',
      [req.params.id]
    );
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/kras/templates/:id/kpi-templates - Delete all KPI templates for a KRA template
router.delete('/templates/:id/kpi-templates', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Verify the KRA template exists
    const kraCheck = await query(
      'SELECT id FROM kra_templates WHERE id = $1',
      [id]
    );
    
    if (kraCheck.rows.length === 0) {
      return res.status(404).json({ error: 'KRA template not found' });
    }
    
    // Delete all KPI templates for this KRA template
    const result = await query(
      'DELETE FROM kpi_templates WHERE kra_template_id = $1',
      [id]
    );
    
    res.json({ 
      success: true, 
      message: `Deleted ${result.rowCount} KPI template(s)` 
    });
  } catch (error) {
    console.error('Delete KPI templates error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/kras/kpi-templates - Get KPI templates by kra_template_id query param
router.get('/kpi-templates', authMiddleware, async (req, res) => {
  try {
    const { kra_template_id } = req.query;
    
    if (!kra_template_id) {
      return res.status(400).json({ error: 'kra_template_id is required' });
    }
    
    const result = await query(
      'SELECT * FROM kpi_templates WHERE kra_template_id = $1 ORDER BY title ASC',
      [kra_template_id]
    );
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/kras/kpi-templates - Create a new KPI template
router.post('/kpi-templates', authMiddleware, async (req, res) => {
  try {
    const { kra_template_id, title, description, metric_type, suggested_target, suggested_weight, target_value, weight, calibration } = req.body;
    
    if (!kra_template_id || !title) {
      return res.status(400).json({ error: 'kra_template_id and title are required' });
    }
    
    // Support both new field names (suggested_target, suggested_weight) and legacy (target_value, weight)
    const target = suggested_target || target_value || null;
    const kpiWeight = suggested_weight || weight || 50;
    
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
      `INSERT INTO kpi_templates (kra_template_id, title, description, metric_type, suggested_target, suggested_weight, calibration)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [kra_template_id, title, description || null, metric_type || 'number', target, kpiWeight, calibrationJson]
    );
    
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    console.error('Create KPI template error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/kras/kpi-templates/:id - Update an existing KPI template
router.put('/kpi-templates/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, metric_type, suggested_target, suggested_weight, target_value, weight, calibration } = req.body;
    
    // Support both new field names (suggested_target, suggested_weight) and legacy (target_value, weight)
    const target = suggested_target !== undefined ? suggested_target : (target_value !== undefined ? target_value : null);
    const kpiWeight = suggested_weight !== undefined ? suggested_weight : (weight !== undefined ? weight : undefined);
    
    // Validate and format calibration if provided
    let calibrationJson = undefined;
    if (calibration !== undefined) {
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
    
    if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(title);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description || null);
    }
    if (metric_type !== undefined) {
      updates.push(`metric_type = $${paramIndex++}`);
      values.push(metric_type);
    }
    if (target !== undefined) {
      updates.push(`suggested_target = $${paramIndex++}`);
      values.push(target);
    }
    if (kpiWeight !== undefined) {
      updates.push(`suggested_weight = $${paramIndex++}`);
      values.push(kpiWeight);
    }
    if (calibrationJson !== undefined) {
      updates.push(`calibration = $${paramIndex++}`);
      values.push(calibrationJson);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    updates.push(`updated_at = NOW()`);
    values.push(id);
    
    const result = await query(
      `UPDATE kpi_templates 
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'KPI template not found' });
    }
    
    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Update KPI template error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/kras/kpi-templates/:id - Delete a specific KPI template
router.delete('/kpi-templates/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query(
      'DELETE FROM kpi_templates WHERE id = $1 RETURNING id',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'KPI template not found' });
    }
    
    res.json({ success: true, message: 'KPI template deleted successfully' });
  } catch (error) {
    console.error('Delete KPI template error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== LATE SUBMISSION PERMISSIONS ==========

// GET /api/kras/late-permissions
// Restricted to HR Admin and System Admin
router.get('/late-permissions', authMiddleware, requireRole(['hr_admin', 'system_admin']), async (req, res) => {
  try {
    const { employee_id, cycle_id } = req.query;
    
    let sql = 'SELECT * FROM late_submission_permissions WHERE revoked_at IS NULL';
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

    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

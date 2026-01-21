import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// ========== DEPARTMENTS ==========
router.get('/departments', authMiddleware, async (req, res) => {
  try {
    const result = await query('SELECT * FROM departments ORDER BY name');
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/departments', authMiddleware, async (req, res) => {
  try {
    const { name, code, description } = req.body;
    const result = await query(
      `INSERT INTO departments (id, name, code, description, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW()) RETURNING *`,
      [name, code, description]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/departments/:id', authMiddleware, async (req, res) => {
  try {
    const { name, code, description, is_active } = req.body;
    const result = await query(
      `UPDATE departments SET name = COALESCE($1, name), code = COALESCE($2, code), 
       description = $3, is_active = COALESCE($4, is_active), updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [name ?? null, code ?? null, description ?? null, is_active ?? null, req.params.id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/departments/:id', authMiddleware, async (req, res) => {
  try {
    await query('DELETE FROM departments WHERE id = $1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== GRADES ==========
router.get('/grades', authMiddleware, async (req, res) => {
  try {
    const result = await query('SELECT * FROM grades ORDER BY level');
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/grades', authMiddleware, async (req, res) => {
  try {
    const { name, code, level, description } = req.body;
    const result = await query(
      `INSERT INTO grades (id, name, code, level, description, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW()) RETURNING *`,
      [name, code, level, description]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/grades/:id', authMiddleware, async (req, res) => {
  try {
    const { name, code, level, description, is_active } = req.body;
    const result = await query(
      `UPDATE grades SET name = COALESCE($1, name), code = COALESCE($2, code), 
       level = COALESCE($3, level), description = $4, is_active = COALESCE($5, is_active), updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [name ?? null, code ?? null, level ?? null, description ?? null, is_active ?? null, req.params.id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/grades/:id', authMiddleware, async (req, res) => {
  try {
    await query('DELETE FROM grades WHERE id = $1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== LOCATIONS ==========
router.get('/locations', authMiddleware, async (req, res) => {
  try {
    const result = await query('SELECT * FROM locations ORDER BY name');
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/locations', authMiddleware, async (req, res) => {
  try {
    const { name, code, country, city } = req.body;
    const result = await query(
      `INSERT INTO locations (id, name, code, country, city, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW()) RETURNING *`,
      [name, code, country, city]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/locations/:id', authMiddleware, async (req, res) => {
  try {
    const { name, code, country, city, is_active } = req.body;
    const result = await query(
      `UPDATE locations SET name = COALESCE($1, name), code = COALESCE($2, code), 
       country = COALESCE($3, country), city = COALESCE($4, city), is_active = COALESCE($5, is_active), updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [name ?? null, code ?? null, country ?? null, city ?? null, is_active ?? null, req.params.id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/locations/:id', authMiddleware, async (req, res) => {
  try {
    await query('DELETE FROM locations WHERE id = $1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== COMPETENCIES ==========
router.get('/competencies', authMiddleware, async (req, res) => {
  try {
    const result = await query('SELECT * FROM competencies ORDER BY name');
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/competencies', authMiddleware, async (req, res) => {
  try {
    const { name, description, category } = req.body;
    const result = await query(
      `INSERT INTO competencies (id, name, description, category, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW()) RETURNING *`,
      [name, description, category]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/competencies/:id', authMiddleware, async (req, res) => {
  try {
    const { name, description, category, is_active } = req.body;
    const result = await query(
      `UPDATE competencies SET name = COALESCE($1, name), description = $2, 
       category = COALESCE($3, category), is_active = COALESCE($4, is_active), updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [name ?? null, description ?? null, category ?? null, is_active ?? null, req.params.id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/competencies/:id', authMiddleware, async (req, res) => {
  try {
    await query('DELETE FROM competencies WHERE id = $1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== BUSINESS UNITS ==========
router.get('/business-units', authMiddleware, async (req, res) => {
  try {
    const result = await query('SELECT * FROM business_units ORDER BY name');
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/business-units', authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Business unit name is required' });
    }
    
    const result = await query(
      `INSERT INTO business_units (id, name, created_at)
       VALUES (gen_random_uuid(), $1, NOW())
       ON CONFLICT (name) DO NOTHING
       RETURNING *`,
      [name.trim()]
    );
    
    if (!result.rows[0]) {
      return res.status(409).json({ error: 'Business unit with this name already exists' });
    }
    
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/business-units/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Business unit name is required' });
    }
    
    const result = await query(
      `UPDATE business_units 
       SET name = $1
       WHERE id = $2
       RETURNING *`,
      [name.trim(), id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Business unit not found' });
    }
    
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/business-units/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM business_units WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Business unit not found' });
    }
    
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== RATING SCALES ==========
router.get('/rating-scales', authMiddleware, async (req, res) => {
  try {
    const { is_default } = req.query;
    let sql = 'SELECT * FROM rating_scales';
    const params = [];
    
    if (is_default !== undefined) {
      sql += ' WHERE is_default = $1';
      params.push(is_default === 'true');
    }
    sql += ' ORDER BY value DESC';
    
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== CALIBRATION SETTINGS ==========
// GET /api/settings/calibration
router.get('/calibration', authMiddleware, async (req, res) => {
  try {
    const result = await query('SELECT * FROM calibration_settings ORDER BY id LIMIT 1');
    const settings = result.rows[0];
    
    // If no settings exist, return default
    if (!settings) {
      return res.json({ data: { is_enabled: false } });
    }
    
    res.json({ data: { is_enabled: settings.is_enabled || false } });
  } catch (error) {
    console.error('Get calibration settings error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/settings/calibration
router.put('/calibration', authMiddleware, async (req, res) => {
  try {
    const { is_enabled } = req.body;
    
    // Check if settings exist
    const existing = await query('SELECT id FROM calibration_settings ORDER BY id LIMIT 1');
    
    if (existing.rows.length > 0) {
      // Update existing
      const result = await query(
        'UPDATE calibration_settings SET is_enabled = $1, updated_at = NOW() RETURNING *',
        [is_enabled || false]
      );
      res.json({ data: { is_enabled: result.rows[0].is_enabled } });
    } else {
      // Create new
      const result = await query(
        'INSERT INTO calibration_settings (id, is_enabled, created_at, updated_at) VALUES (gen_random_uuid(), $1, NOW(), NOW()) RETURNING *',
        [is_enabled || false]
      );
      res.json({ data: { is_enabled: result.rows[0].is_enabled } });
    }
  } catch (error) {
    console.error('Update calibration settings error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/settings/calibration/default-quotas
router.get('/calibration/default-quotas', authMiddleware, async (req, res) => {
  try {
    const result = await query('SELECT * FROM default_calibration_quotas ORDER BY rating_value');
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Get default calibration quotas error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/settings/calibration/default-quotas
router.put('/calibration/default-quotas', authMiddleware, async (req, res) => {
  try {
    const { quotas } = req.body;
    
    if (!Array.isArray(quotas)) {
      return res.status(400).json({ error: 'quotas must be an array' });
    }
    
    // Delete existing quotas
    await query('DELETE FROM default_calibration_quotas');
    
    // Insert new quotas
    if (quotas.length > 0) {
      for (const quota of quotas) {
        await query(
          `INSERT INTO default_calibration_quotas (id, rating_value, percentage, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, NOW(), NOW())`,
          [quota.rating_value, quota.percentage]
        );
      }
    }
    
    // Return updated quotas
    const result = await query('SELECT * FROM default_calibration_quotas ORDER BY rating_value');
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Update default calibration quotas error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/settings/calibration/department-quotas
router.get('/calibration/department-quotas', authMiddleware, async (req, res) => {
  try {
    const result = await query('SELECT * FROM department_calibration_quotas ORDER BY department, rating_value');
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Get department calibration quotas error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/settings/calibration/department-quotas
router.put('/calibration/department-quotas', authMiddleware, async (req, res) => {
  try {
    const { overrides } = req.body;
    
    if (!Array.isArray(overrides)) {
      return res.status(400).json({ error: 'overrides must be an array' });
    }
    
    // Delete all existing department quotas
    await query('DELETE FROM department_calibration_quotas');
    
    // Insert new quotas
    if (overrides.length > 0) {
      for (const override of overrides) {
        await query(
          `INSERT INTO department_calibration_quotas (id, department, rating_value, percentage, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW())`,
          [override.department, override.rating_value, override.percentage]
        );
      }
    }
    
    // Return updated quotas
    const result = await query('SELECT * FROM department_calibration_quotas ORDER BY department, rating_value');
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Update department calibration quotas error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

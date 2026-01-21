import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// GET /api/calibration/groups
router.get('/groups', authMiddleware, async (req, res) => {
  try {
    const { cycle_id, id, status } = req.query;
    let sql = 'SELECT * FROM calibration_groups WHERE 1=1';
    const params = [];
    let idx = 1;

    if (id) { 
      sql += ` AND id = $${idx++}`; 
      params.push(id); 
    }
    if (cycle_id) { 
      sql += ` AND cycle_id = $${idx++}`; 
      params.push(cycle_id); 
    }
    if (status) { 
      sql += ` AND status = $${idx++}`; 
      params.push(status); 
    }

    sql += ' ORDER BY created_at DESC';
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Get calibration groups error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/calibration/groups/:id
router.get('/groups/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('SELECT * FROM calibration_groups WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Calibration group not found' });
    }
    
    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Get calibration group error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/calibration/groups
router.post('/groups', authMiddleware, async (req, res) => {
  try {
    const { name, description, cycle_id, filters, status, created_by } = req.body;
    
    // Handle filters as JSONB - if it's already a string, parse it; if object, stringify it
    let filtersValue = '{}';
    if (filters) {
      if (typeof filters === 'string') {
        try {
          JSON.parse(filters); // Validate it's valid JSON
          filtersValue = filters;
        } catch {
          filtersValue = JSON.stringify(filters);
        }
      } else {
        filtersValue = JSON.stringify(filters);
      }
    }
    
    const result = await query(
      `INSERT INTO calibration_groups (id, cycle_id, name, description, filters, status, created_by, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4::jsonb, $5, $6, NOW(), NOW())
       RETURNING *`,
      [
        cycle_id,
        name,
        description || null,
        filtersValue,
        status || 'draft',
        created_by || req.user?.id || null
      ]
    );
    
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    console.error('Create calibration group error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/calibration/groups/:id
router.put('/groups/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, filters, status } = req.body;
    
    const updates = [];
    const params = [];
    let idx = 1;

    if (name !== undefined) {
      updates.push(`name = $${idx++}`);
      params.push(name);
    }
    if (description !== undefined) {
      updates.push(`description = $${idx++}`);
      params.push(description);
    }
    if (filters !== undefined) {
      // Handle filters as JSONB
      let filtersValue = '{}';
      if (filters) {
        if (typeof filters === 'string') {
          try {
            JSON.parse(filters); // Validate it's valid JSON
            filtersValue = filters;
          } catch {
            filtersValue = JSON.stringify(filters);
          }
        } else {
          filtersValue = JSON.stringify(filters);
        }
      }
      updates.push(`filters = $${idx++}::jsonb`);
      params.push(filtersValue);
    }
    if (status !== undefined) {
      updates.push(`status = $${idx++}`);
      params.push(status);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    params.push(id);

    const result = await query(
      `UPDATE calibration_groups SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Calibration group not found' });
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Update calibration group error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/calibration/groups/:id
router.delete('/groups/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM calibration_groups WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Calibration group not found' });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete calibration group error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/calibration/groups/:groupId/quota-rules
router.get('/groups/:groupId/quota-rules', authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;
    const result = await query(
      'SELECT rating_value, percentage FROM quota_rules WHERE calibration_group_id = $1 ORDER BY rating_value',
      [groupId]
    );
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Get quota rules error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/calibration/groups/:groupId/quota-rules
router.post('/groups/:groupId/quota-rules', authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { rating_value, percentage, max_count } = req.body;
    
    // Check if quota rule already exists
    const existing = await query(
      'SELECT * FROM quota_rules WHERE calibration_group_id = $1 AND rating_value = $2',
      [groupId, rating_value]
    );
    
    let result;
    if (existing.rows.length > 0) {
      // Update existing
      result = await query(
        `UPDATE quota_rules 
         SET percentage = $1, max_count = $2
         WHERE calibration_group_id = $3 AND rating_value = $4
         RETURNING *`,
        [percentage || null, max_count || null, groupId, rating_value]
      );
    } else {
      // Insert new
      result = await query(
        `INSERT INTO quota_rules (id, calibration_group_id, rating_value, percentage, max_count, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())
         RETURNING *`,
        [groupId, rating_value, percentage || null, max_count || null]
      );
    }
    
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    console.error('Create quota rule error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/calibration/groups/:groupId/entries
router.get('/groups/:groupId/entries', authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;
    const result = await query(
      `SELECT ce.*, e.emp_code, e.full_name, e.department, e.grade
       FROM calibration_entries ce
       JOIN employees e ON ce.employee_id = e.id
       WHERE ce.calibration_group_id = $1
       ORDER BY e.full_name`,
      [groupId]
    );
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Get calibration entries error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/calibration/groups/:groupId/entries
router.post('/groups/:groupId/entries', authMiddleware, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { employee_id, original_rating, calibrated_rating } = req.body;
    
    const result = await query(
      `INSERT INTO calibration_entries (id, calibration_group_id, employee_id, original_rating, calibrated_rating, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())
       ON CONFLICT (calibration_group_id, employee_id) DO UPDATE SET
         original_rating = EXCLUDED.original_rating,
         calibrated_rating = EXCLUDED.calibrated_rating
       RETURNING *`,
      [groupId, employee_id, original_rating, calibrated_rating || null]
    );
    
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    console.error('Create calibration entry error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/calibration/entries
router.get('/entries', authMiddleware, async (req, res) => {
  try {
    const { group_ids } = req.query;
    
    let sql = `
      SELECT ce.*, e.emp_code, e.full_name, e.department, e.grade
      FROM calibration_entries ce
      JOIN employees e ON ce.employee_id = e.id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (group_ids) {
      const groupIdArray = Array.isArray(group_ids) ? group_ids : group_ids.split(',');
      const placeholders = groupIdArray.map((_, i) => `$${idx + i}`).join(', ');
      sql += ` AND ce.calibration_group_id IN (${placeholders})`;
      params.push(...groupIdArray);
      idx += groupIdArray.length;
    }

    sql += ' ORDER BY e.full_name';
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Get calibration entries error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/calibration/entries/:entryId
router.put('/entries/:entryId', authMiddleware, async (req, res) => {
  try {
    const { entryId } = req.params;
    const { original_rating, calibrated_rating, final_rating } = req.body;
    
    const updates = [];
    const params = [];
    let idx = 1;

    if (original_rating !== undefined) {
      updates.push(`original_rating = $${idx++}`);
      params.push(original_rating);
    }
    if (calibrated_rating !== undefined) {
      updates.push(`calibrated_rating = $${idx++}`);
      params.push(calibrated_rating);
    }
    if (final_rating !== undefined) {
      updates.push(`final_rating = $${idx++}`);
      params.push(final_rating);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    params.push(entryId);

    const result = await query(
      `UPDATE calibration_entries SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Calibration entry not found' });
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Update calibration entry error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

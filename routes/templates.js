import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Get all KRA templates
router.get('/kra', authMiddleware, async (req, res) => {
  try {
    const { is_active, department, grade } = req.query;
    
    let sql = `
      SELECT 
        kt.*,
        COUNT(kpi.id)::INTEGER as kpi_count
      FROM kra_templates kt
      LEFT JOIN kpi_templates kpi ON kpi.kra_template_id = kt.id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (is_active !== undefined) {
      sql += ` AND kt.is_active = $${idx++}`;
      params.push(is_active === 'true');
    }

    if (department) {
      sql += ` AND kt.department = $${idx++}`;
      params.push(department);
    }

    if (grade) {
      sql += ` AND kt.grade = $${idx++}`;
      params.push(grade);
    }

    sql += ' GROUP BY kt.id ORDER BY kt.created_at DESC';
    
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Get KRA templates error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Duplicate a KRA template (must come before /kra/:id route)
router.post('/kra/:id/duplicate', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get the original template
    const templateResult = await query(
      'SELECT * FROM kra_templates WHERE id = $1',
      [id]
    );

    if (templateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const originalTemplate = templateResult.rows[0];

    // Get all KPI templates for the original template
    const kpisResult = await query(
      'SELECT * FROM kpi_templates WHERE kra_template_id = $1 ORDER BY created_at ASC',
      [id]
    );

    // Create a new KRA template with the same data (but new ID)
    const newTemplateResult = await query(
      `INSERT INTO kra_templates (title, description, suggested_weight, department, grade, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        `${originalTemplate.title} (Copy)`,
        originalTemplate.description,
        originalTemplate.suggested_weight,
        originalTemplate.department,
        originalTemplate.grade,
        originalTemplate.is_active,
        req.user.userId
      ]
    );

    const newTemplate = newTemplateResult.rows[0];

    // Duplicate all KPI templates
    const newKpis = [];
    for (const kpi of kpisResult.rows) {
      const kpiResult = await query(
        `INSERT INTO kpi_templates (kra_template_id, title, description, metric_type, suggested_target, suggested_weight, calibration)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          newTemplate.id,
          kpi.title,
          kpi.description,
          kpi.metric_type,
          kpi.suggested_target,
          kpi.suggested_weight,
          kpi.calibration || null
        ]
      );
      newKpis.push(kpiResult.rows[0]);
    }

    res.status(201).json({ 
      data: {
        ...newTemplate,
        kpis: newKpis
      }
    });
  } catch (error) {
    console.error('Duplicate KRA template error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get a specific KRA template with its KPIs
router.get('/kra/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    const templateResult = await query(
      'SELECT * FROM kra_templates WHERE id = $1',
      [id]
    );

    if (templateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const kpisResult = await query(
      'SELECT * FROM kpi_templates WHERE kra_template_id = $1 ORDER BY created_at ASC',
      [id]
    );

    res.json({ 
      data: {
        ...templateResult.rows[0],
        kpis: kpisResult.rows
      }
    });
  } catch (error) {
    console.error('Get KRA template error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create a new KRA template
router.post('/kra', authMiddleware, async (req, res) => {
  try {
    const { title, description, suggested_weight, department, grade, is_active, kpis } = req.body;
    
    const result = await query(
      `INSERT INTO kra_templates (title, description, suggested_weight, department, grade, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [title, description, suggested_weight || 25, department, grade, is_active !== false, req.user.userId]
    );

    const template = result.rows[0];

    // Insert KPI templates if provided
    if (kpis && kpis.length > 0) {
      for (const kpi of kpis) {
        await query(
          `INSERT INTO kpi_templates (kra_template_id, title, description, metric_type, suggested_target, suggested_weight, calibration)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            template.id, 
            kpi.title, 
            kpi.description, 
            kpi.metric_type || 'number', 
            kpi.suggested_target, 
            kpi.suggested_weight || 50,
            kpi.calibration ? JSON.stringify(kpi.calibration) : null
          ]
        );
      }
    }

    res.status(201).json({ data: template });
  } catch (error) {
    console.error('Create KRA template error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update a KRA template
router.put('/kra/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, suggested_weight, department, grade, is_active, kpis } = req.body;
    
    const result = await query(
      `UPDATE kra_templates 
       SET title = $1, description = $2, suggested_weight = $3, department = $4, grade = $5, is_active = $6, updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [title, description, suggested_weight, department, grade, is_active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Update KPIs if provided
    if (kpis) {
      // Delete existing KPIs
      await query('DELETE FROM kpi_templates WHERE kra_template_id = $1', [id]);
      
      // Insert new KPIs
      for (const kpi of kpis) {
        await query(
          `INSERT INTO kpi_templates (kra_template_id, title, description, metric_type, suggested_target, suggested_weight, calibration)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            id, 
            kpi.title, 
            kpi.description, 
            kpi.metric_type || 'number', 
            kpi.suggested_target, 
            kpi.suggested_weight || 50,
            kpi.calibration ? JSON.stringify(kpi.calibration) : null
          ]
        );
      }
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Update KRA template error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete a KRA template
router.delete('/kra/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    // KPI templates will be cascade deleted
    const result = await query(
      'DELETE FROM kra_templates WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete KRA template error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all KPI templates for a KRA
router.get('/kra/:kraId/kpis', authMiddleware, async (req, res) => {
  try {
    const { kraId } = req.params;
    
    const result = await query(
      'SELECT * FROM kpi_templates WHERE kra_template_id = $1 ORDER BY created_at ASC',
      [kraId]
    );

    res.json({ data: result.rows });
  } catch (error) {
    console.error('Get KPI templates error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

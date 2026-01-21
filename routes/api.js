import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Helper function to build dynamic WHERE clauses
const buildWhereClause = (filters, startIndex = 1) => {
  const conditions = [];
  const values = [];
  let paramIndex = startIndex;

  for (const [key, value] of Object.entries(filters)) {
    if (value === null) {
      conditions.push(`${key} IS NULL`);
    } else if (typeof value === 'object' && value.operator) {
      // Handle special operators
      switch (value.operator) {
        case 'is':
          if (value.value === null) {
            conditions.push(`${key} IS NULL`);
          } else {
            conditions.push(`${key} IS ${value.value}`);
          }
          break;
        case 'not':
          if (value.value === null) {
            conditions.push(`${key} IS NOT NULL`);
          } else {
            conditions.push(`${key} != $${paramIndex}`);
            values.push(value.value);
            paramIndex++;
          }
          break;
        case 'in':
          if (Array.isArray(value.value) && value.value.length > 0) {
            const placeholders = value.value.map(() => `$${paramIndex++}`).join(', ');
            conditions.push(`${key} IN (${placeholders})`);
            values.push(...value.value);
          }
          break;
        case 'neq':
          conditions.push(`${key} != $${paramIndex}`);
          values.push(value.value);
          paramIndex++;
          break;
        case 'gt':
          conditions.push(`${key} > $${paramIndex}`);
          values.push(value.value);
          paramIndex++;
          break;
        case 'gte':
          conditions.push(`${key} >= $${paramIndex}`);
          values.push(value.value);
          paramIndex++;
          break;
        case 'lt':
          conditions.push(`${key} < $${paramIndex}`);
          values.push(value.value);
          paramIndex++;
          break;
        case 'lte':
          conditions.push(`${key} <= $${paramIndex}`);
          values.push(value.value);
          paramIndex++;
          break;
        case 'like':
          conditions.push(`${key} ILIKE $${paramIndex}`);
          values.push(value.value);
          paramIndex++;
          break;
        default:
          conditions.push(`${key} = $${paramIndex}`);
          values.push(value.value);
          paramIndex++;
      }
    } else {
      conditions.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  }

  return { whereClause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '', values, nextIndex: paramIndex };
};

// Generic SELECT endpoint
router.post('/query/:table', authMiddleware, async (req, res) => {
  try {
    const { table } = req.params;
    const { select = '*', filters = {}, order, limit, offset, single = false, count = false, head = false } = req.body;

    // Validate table name to prevent SQL injection
    const validTables = [
      'profiles', 'employees', 'manager_history', 'performance_cycles',
      'rating_scales', 'competencies', 'kras', 'goals', 'goal_attachments',
      'bonus_kras', 'bonus_kpis', 'self_evaluations', 'goal_self_ratings',
      'competency_self_ratings', 'manager_evaluations', 'goal_manager_ratings',
      'bonus_kra_ratings', 'quarterly_self_reviews', 'quarterly_kpi_progress',
      'quarterly_manager_reviews', 'quarterly_kpi_manager_feedback',
      'calibration_groups', 'quota_rules', 'calibration_entries',
      'calibration_settings', 'default_calibration_quotas', 'department_calibration_quotas',
      'late_submission_permissions', 'kra_templates', 'kpi_templates',
      'audit_logs', 'notifications', 'departments', 'business_units', 'grades', 'locations'
    ];

    if (!validTables.includes(table)) {
      return res.status(400).json({ error: `Invalid table: ${table}` });
    }

    const { whereClause, values, nextIndex } = buildWhereClause(filters);

    let sql = '';
    if (count && head) {
      sql = `SELECT COUNT(*) as count FROM ${table} ${whereClause}`;
    } else if (count) {
      sql = `SELECT ${select}, COUNT(*) OVER() as full_count FROM ${table} ${whereClause}`;
    } else {
      sql = `SELECT ${select} FROM ${table} ${whereClause}`;
    }

    // Add ORDER BY
    if (order) {
      const orderClauses = order.map(o => `${o.column} ${o.ascending ? 'ASC' : 'DESC'}`).join(', ');
      sql += ` ORDER BY ${orderClauses}`;
    }

    // Add LIMIT and OFFSET
    if (limit !== undefined) {
      sql += ` LIMIT $${nextIndex}`;
      values.push(limit);
    }
    if (offset !== undefined) {
      sql += ` OFFSET $${nextIndex + (limit !== undefined ? 1 : 0)}`;
      values.push(offset);
    }

    const result = await query(sql, values);

    if (count && head) {
      return res.json({ count: parseInt(result.rows[0]?.count || 0), data: null });
    }

    let data = result.rows;
    let totalCount = null;

    if (count && data.length > 0) {
      totalCount = parseInt(data[0].full_count || 0);
      data = data.map(({ full_count, ...rest }) => rest);
    }

    if (single) {
      if (data.length === 0) {
        return res.status(404).json({ error: 'No rows returned', data: null });
      }
      return res.json({ data: data[0], count: totalCount });
    }

    res.json({ data, count: totalCount });
  } catch (error) {
    console.error('Query error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generic INSERT endpoint
router.post('/insert/:table', authMiddleware, async (req, res) => {
  try {
    const { table } = req.params;
    const { data: insertData, returning = '*' } = req.body;

    const validTables = [
      'profiles', 'employees', 'manager_history', 'performance_cycles',
      'rating_scales', 'competencies', 'kras', 'goals', 'goal_attachments',
      'bonus_kras', 'bonus_kpis', 'self_evaluations', 'goal_self_ratings',
      'competency_self_ratings', 'manager_evaluations', 'goal_manager_ratings',
      'bonus_kra_ratings', 'quarterly_self_reviews', 'quarterly_kpi_progress',
      'quarterly_manager_reviews', 'quarterly_kpi_manager_feedback',
      'calibration_groups', 'quota_rules', 'calibration_entries',
      'calibration_settings', 'default_calibration_quotas', 'department_calibration_quotas',
      'late_submission_permissions', 'kra_templates', 'kpi_templates',
      'audit_logs', 'notifications', 'departments', 'business_units', 'grades', 'locations'
    ];

    if (!validTables.includes(table)) {
      return res.status(400).json({ error: `Invalid table: ${table}` });
    }

    // Handle array of inserts
    const records = Array.isArray(insertData) ? insertData : [insertData];
    const results = [];

    for (const record of records) {
      const columns = Object.keys(record);
      const values = Object.values(record);
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');

      const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING ${returning}`;
      const result = await query(sql, values);
      results.push(result.rows[0]);
    }

    res.json({ data: Array.isArray(insertData) ? results : results[0] });
  } catch (error) {
    console.error('Insert error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generic UPDATE endpoint
router.post('/update/:table', authMiddleware, async (req, res) => {
  try {
    const { table } = req.params;
    const { data: updateData, filters = {}, returning = '*' } = req.body;

    const validTables = [
      'profiles', 'employees', 'manager_history', 'performance_cycles',
      'rating_scales', 'competencies', 'kras', 'goals', 'goal_attachments',
      'bonus_kras', 'bonus_kpis', 'self_evaluations', 'goal_self_ratings',
      'competency_self_ratings', 'manager_evaluations', 'goal_manager_ratings',
      'bonus_kra_ratings', 'quarterly_self_reviews', 'quarterly_kpi_progress',
      'quarterly_manager_reviews', 'quarterly_kpi_manager_feedback',
      'calibration_groups', 'quota_rules', 'calibration_entries',
      'calibration_settings', 'default_calibration_quotas', 'department_calibration_quotas',
      'late_submission_permissions', 'kra_templates', 'kpi_templates',
      'audit_logs', 'notifications', 'departments', 'business_units', 'grades', 'locations'
    ];

    if (!validTables.includes(table)) {
      return res.status(400).json({ error: `Invalid table: ${table}` });
    }

    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updateData)) {
      setClauses.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }

    const { whereClause, values: whereValues } = buildWhereClause(filters, paramIndex);
    values.push(...whereValues);

    const sql = `UPDATE ${table} SET ${setClauses.join(', ')} ${whereClause} RETURNING ${returning}`;
    const result = await query(sql, values);

    res.json({ data: result.rows });
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generic DELETE endpoint
router.post('/delete/:table', authMiddleware, async (req, res) => {
  try {
    const { table } = req.params;
    const { filters = {} } = req.body;

    const validTables = [
      'profiles', 'employees', 'manager_history', 'performance_cycles',
      'rating_scales', 'competencies', 'kras', 'goals', 'goal_attachments',
      'bonus_kras', 'bonus_kpis', 'self_evaluations', 'goal_self_ratings',
      'competency_self_ratings', 'manager_evaluations', 'goal_manager_ratings',
      'bonus_kra_ratings', 'quarterly_self_reviews', 'quarterly_kpi_progress',
      'quarterly_manager_reviews', 'quarterly_kpi_manager_feedback',
      'calibration_groups', 'quota_rules', 'calibration_entries',
      'calibration_settings', 'default_calibration_quotas', 'department_calibration_quotas',
      'late_submission_permissions', 'kra_templates', 'kpi_templates',
      'audit_logs', 'notifications', 'departments', 'business_units', 'grades', 'locations'
    ];

    if (!validTables.includes(table)) {
      return res.status(400).json({ error: `Invalid table: ${table}` });
    }

    const { whereClause, values } = buildWhereClause(filters);

    // Prevent accidental mass deletion
    if (!whereClause) {
      return res.status(400).json({ error: 'Filters are required for DELETE operations' });
    }

    const sql = `DELETE FROM ${table} ${whereClause}`;
    const result = await query(sql, values);

    res.json({ data: null, count: result.rowCount });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Upsert endpoint
router.post('/upsert/:table', authMiddleware, async (req, res) => {
  try {
    const { table } = req.params;
    const { data: upsertData, onConflict, returning = '*' } = req.body;

    const validTables = [
      'profiles', 'employees', 'manager_history', 'performance_cycles',
      'rating_scales', 'competencies', 'kras', 'goals', 'goal_attachments',
      'bonus_kras', 'bonus_kpis', 'self_evaluations', 'goal_self_ratings',
      'competency_self_ratings', 'manager_evaluations', 'goal_manager_ratings',
      'bonus_kra_ratings', 'quarterly_self_reviews', 'quarterly_kpi_progress',
      'quarterly_manager_reviews', 'quarterly_kpi_manager_feedback',
      'calibration_groups', 'quota_rules', 'calibration_entries',
      'calibration_settings', 'default_calibration_quotas', 'department_calibration_quotas',
      'late_submission_permissions', 'kra_templates', 'kpi_templates',
      'audit_logs', 'notifications', 'departments', 'business_units', 'grades', 'locations'
    ];

    if (!validTables.includes(table)) {
      return res.status(400).json({ error: `Invalid table: ${table}` });
    }

    const columns = Object.keys(upsertData);
    const values = Object.values(upsertData);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    
    const updateClauses = columns
      .filter(col => !onConflict?.includes(col))
      .map(col => `${col} = EXCLUDED.${col}`)
      .join(', ');

    const conflictColumns = onConflict || ['id'];
    
    const sql = `
      INSERT INTO ${table} (${columns.join(', ')}) 
      VALUES (${placeholders})
      ON CONFLICT (${conflictColumns.join(', ')}) 
      DO UPDATE SET ${updateClauses}
      RETURNING ${returning}
    `;

    const result = await query(sql, values);
    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Upsert error:', error);
    res.status(500).json({ error: error.message });
  }
});

// RPC endpoint for custom functions
router.post('/rpc/:functionName', authMiddleware, async (req, res) => {
  try {
    const { functionName } = req.params;
    const params = req.body;

    // Define allowed functions and their implementations
    const functions = {
      'get_current_employee_id': async () => {
        const result = await query(
          'SELECT id FROM employees WHERE profile_id = $1',
          [req.user.userId]
        );
        return result.rows[0]?.id || null;
      },
      'has_role': async ({ _role, _user_id }) => {
        const result = await query(
          'SELECT EXISTS(SELECT 1 FROM profiles WHERE id = $1 AND role = $2) as has_role',
          [_user_id, _role]
        );
        return result.rows[0]?.has_role || false;
      },
      'has_any_role': async ({ _roles, _user_id }) => {
        const result = await query(
          'SELECT EXISTS(SELECT 1 FROM profiles WHERE id = $1 AND role = ANY($2)) as has_role',
          [_user_id, _roles]
        );
        return result.rows[0]?.has_role || false;
      }
    };

    if (!functions[functionName]) {
      return res.status(400).json({ error: `Unknown function: ${functionName}` });
    }

    const result = await functions[functionName](params);
    res.json({ data: result });
  } catch (error) {
    console.error('RPC error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;


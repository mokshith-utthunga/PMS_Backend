import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// GET /api/employees - Get all employees (with optional filters)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { department, status, manager_code, manager_id, limit = 100, offset = 0 } = req.query;
    
    // Build WHERE clause for both count and data queries
    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (department) {
      whereClause += ` AND department = $${paramIndex++}`;
      params.push(department);
    }
    if (status) {
      whereClause += ` AND status = $${paramIndex++}`;
      params.push(status);
    }
    
    // Handle manager filter: manager_id is UUID, manager_code is emp_code string
    let managerCodeValue = manager_code;
    if (manager_id && !manager_code) {
      // If manager_id is provided (UUID), look up the employee's emp_code
      const managerResult = await query(
        'SELECT emp_code FROM employees WHERE id = $1',
        [manager_id]
      );
      if (managerResult.rows.length > 0) {
        managerCodeValue = managerResult.rows[0].emp_code;
      } else {
        // Manager not found, return empty result
        return res.json({ data: [], count: 0, totalCount: 0 });
      }
    }
    
    if (managerCodeValue) {
      whereClause += ` AND manager_code = $${paramIndex++}`;
      params.push(managerCodeValue);
    }

    // Build the main query with window function for total count
    const sql = `
      SELECT *, COUNT(*) OVER() as total_count
      FROM employees 
      ${whereClause}
      ORDER BY created_at DESC 
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `;
    params.push(parseInt(limit), parseInt(offset));

    const result = await query(sql, params);
    
    // Extract totalCount from first row (all rows will have the same total_count)
    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;
    
    // Remove total_count from each row before sending response
    const data = result.rows.map(({ total_count, ...row }) => row);
    
    res.json({ 
      data, 
      count: data.length,
      totalCount 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/employees/me - Get current user's employee record
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM employees WHERE profile_id = $1',
      [req.user.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/employees/:id - Get employee by ID
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM employees WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/employees/:id/team - Get direct reports
router.get('/:id/team', authMiddleware, async (req, res) => {
  try {
    // First, get the employee's emp_code (manager_code now references emp_code, not id)
    const empResult = await query(
      'SELECT emp_code FROM employees WHERE id = $1',
      [req.params.id]
    );
    
    if (empResult.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    const managerCode = empResult.rows[0].emp_code;
    
    const result = await query(
      'SELECT * FROM employees WHERE manager_code = $1 ORDER BY full_name',
      [managerCode]
    );
    res.json({ data: result.rows, count: result.rows.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/employees - Create employee
router.post('/', authMiddleware, async (req, res) => {
  try {
    // Support both old (emp_id, manager_id, user_id, first_name, last_name) and new (emp_code, manager_code, profile_id, full_name) parameter names
    const emp_code = req.body.emp_code || req.body.emp_id;
    const manager_code = req.body.manager_code || req.body.manager_id;
    const profile_id = req.body.profile_id || req.body.user_id;
    // Support both full_name and first_name/last_name for backward compatibility
    const full_name = req.body.full_name || (req.body.first_name && req.body.last_name ? `${req.body.first_name} ${req.body.last_name}` : req.body.first_name || req.body.last_name || '');
    const { email, department, business_unit, grade, location, date_of_joining, status, sub_department } = req.body;
    
    const result = await query(
      `INSERT INTO employees (id, emp_code, profile_id, full_name, email, department, business_unit, grade, location, manager_code, date_of_joining, status, sub_department, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
       RETURNING *`,
      [emp_code, profile_id, full_name, email, department, business_unit, grade, location, manager_code, date_of_joining, status || 'active', sub_department]
    );
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/employees/:id - Update employee
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    // Support both old (manager_id, first_name, last_name) and new (manager_code, full_name) parameter names
    const manager_code = req.body.manager_code || req.body.manager_id;
    // Support both full_name and first_name/last_name for backward compatibility
    const full_name = req.body.full_name || (req.body.first_name && req.body.last_name ? `${req.body.first_name} ${req.body.last_name}` : req.body.first_name || req.body.last_name || null);
    const { email, department, business_unit, grade, location, status, sub_department } = req.body;
    
    const result = await query(
      `UPDATE employees SET 
        full_name = COALESCE($1, full_name),
        email = COALESCE($2, email),
        department = COALESCE($3, department),
        business_unit = COALESCE($4, business_unit),
        grade = COALESCE($5, grade),
        location = COALESCE($6, location),
        manager_code = $7,
        status = COALESCE($8, status),
        sub_department = COALESCE($9, sub_department),
        updated_at = NOW()
       WHERE id = $10 RETURNING *`,
      [full_name ?? null, email ?? null, department ?? null, business_unit ?? null, grade ?? null, location ?? null, manager_code ?? null, status ?? null, sub_department ?? null, req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/employees/:id - Delete employee
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM employees WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    res.json({ message: 'Employee deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

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
    // First, get the employee's emp_code (manager_code stores emp_code value)
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

// ========== ADMIN/HR OVERRIDE ENDPOINTS ==========

// GET /api/employees/:id/quarterly-review - Get employee quarterly review bundle (goals + self + manager)
router.get('/:id/quarterly-review', authMiddleware, requireRole(['hr_admin', 'system_admin']), async (req, res) => {
  try {
    const { id: employeeId } = req.params;
    const { cycle_id, quarter } = req.query;
    
    if (!cycle_id || !quarter) {
      return res.status(400).json({ error: 'cycle_id and quarter are required' });
    }
    
    const quarterNum = parseInt(quarter);
    if (quarterNum < 1 || quarterNum > 4) {
      return res.status(400).json({ error: 'quarter must be between 1 and 4' });
    }
    
    // Get KRAs and KPIs for the quarter
    const krasResult = await query(
      `SELECT k.* FROM kras k
       WHERE k.employee_id = $1 AND k.cycle_id = $2 AND (k.quarter = $3 OR k.quarter IS NULL)
       ORDER BY k.created_at ASC`,
      [employeeId, cycle_id, quarterNum]
    );
    
    const kpisResult = await query(
      `SELECT g.* FROM goals g
       WHERE g.employee_id = $1 AND g.cycle_id = $2 AND (g.quarter = $3 OR g.quarter IS NULL)
       ORDER BY g.created_at ASC`,
      [employeeId, cycle_id, quarterNum]
    );
    
    // Get quarterly self review
    const selfReviewResult = await query(
      `SELECT * FROM quarterly_self_reviews
       WHERE employee_id = $1 AND cycle_id = $2 AND quarter = $3`,
      [employeeId, cycle_id, quarterNum]
    );
    
    // Get goal self ratings if self review exists
    let goalSelfRatings = [];
    if (selfReviewResult.rows.length > 0) {
      const selfReviewId = selfReviewResult.rows[0].id;
      const ratingsResult = await query(
        `SELECT * FROM goal_self_ratings
         WHERE quarterly_review_id = $1`,
        [selfReviewId]
      );
      goalSelfRatings = ratingsResult.rows;
    }
    
    // Get quarterly manager review
    const managerReviewResult = await query(
      `SELECT * FROM quarterly_manager_reviews
       WHERE employee_id = $1 AND cycle_id = $2 AND quarter = $3`,
      [employeeId, cycle_id, quarterNum]
    );
    
    // Get manager KPI feedback if manager review exists
    let managerKpiFeedback = [];
    if (managerReviewResult.rows.length > 0) {
      const managerReviewId = managerReviewResult.rows[0].id;
      const feedbackResult = await query(
        `SELECT * FROM quarterly_kpi_manager_feedback
         WHERE manager_review_id = $1`,
        [managerReviewId]
      );
      managerKpiFeedback = feedbackResult.rows;
    }
    
    res.json({
      data: {
        kras: krasResult.rows,
        kpis: kpisResult.rows,
        selfReview: selfReviewResult.rows[0] || null,
        goalSelfRatings,
        managerReview: managerReviewResult.rows[0] || null,
        managerKpiFeedback
      }
    });
  } catch (error) {
    console.error('Get quarterly review error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/employees/:id/admin-override-quarters - Get quarters with admin overrides
router.get('/:id/admin-override-quarters', authMiddleware, requireRole(['hr_admin', 'system_admin']), async (req, res) => {
  try {
    const { id: employeeId } = req.params;
    const { cycle_id } = req.query;
    
    if (!cycle_id) {
      return res.status(400).json({ error: 'cycle_id is required' });
    }
    
    // Check which quarters have admin overrides
    const quartersWithOverrides = new Set();
    
    // Check goals
    const goalsResult = await query(
      `SELECT DISTINCT quarter FROM goals
       WHERE employee_id = $1 AND cycle_id = $2 AND admin_override = true AND quarter IS NOT NULL`,
      [employeeId, cycle_id]
    );
    goalsResult.rows.forEach(row => quartersWithOverrides.add(row.quarter));
    
    // Check self reviews
    const selfReviewsResult = await query(
      `SELECT DISTINCT quarter FROM quarterly_self_reviews
       WHERE employee_id = $1 AND cycle_id = $2 AND admin_override = true`,
      [employeeId, cycle_id]
    );
    selfReviewsResult.rows.forEach(row => quartersWithOverrides.add(row.quarter));
    
    // Check manager reviews
    const managerReviewsResult = await query(
      `SELECT DISTINCT quarter FROM quarterly_manager_reviews
       WHERE employee_id = $1 AND cycle_id = $2 AND admin_override = true`,
      [employeeId, cycle_id]
    );
    managerReviewsResult.rows.forEach(row => quartersWithOverrides.add(row.quarter));
    
    res.json({
      data: Array.from(quartersWithOverrides).sort()
    });
  } catch (error) {
    console.error('Get admin override quarters error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/employees/:id/goals/:goalId/admin-override - Admin override for goal
router.put('/:id/goals/:goalId/admin-override', authMiddleware, requireRole(['hr_admin', 'system_admin']), async (req, res) => {
  try {
    const { id: employeeId, goalId } = req.params;
    const userId = req.user.userId;
    const { title, description, target_value, weight, metric_type, status, quarter } = req.body;
    
    // Verify goal belongs to employee
    const goalCheck = await query(
      'SELECT employee_id FROM goals WHERE id = $1',
      [goalId]
    );
    if (goalCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    if (goalCheck.rows[0].employee_id !== employeeId) {
      return res.status(403).json({ error: 'Goal does not belong to this employee' });
    }
    
    // Build update query
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(title);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description);
    }
    if (target_value !== undefined) {
      updates.push(`target_value = $${paramIndex++}`);
      values.push(target_value);
    }
    if (weight !== undefined) {
      updates.push(`weight = $${paramIndex++}`);
      values.push(weight);
    }
    if (metric_type !== undefined) {
      updates.push(`metric_type = $${paramIndex++}`);
      values.push(metric_type);
    }
    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(status);
    }
    if (quarter !== undefined) {
      updates.push(`quarter = $${paramIndex++}`);
      values.push(quarter);
    }
    
    // Always set admin override fields
    updates.push(`admin_override = true`);
    updates.push(`admin_override_by = $${paramIndex++}`);
    values.push(userId);
    updates.push(`admin_override_at = NOW()`);
    updates.push(`updated_at = NOW()`);
    
    const result = await query(
      `UPDATE goals SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      [...values, goalId]
    );
    
    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Admin override goal error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/employees/:id/self-review/admin-override - Admin override for self evaluation
router.put('/:id/self-review/admin-override', authMiddleware, requireRole(['hr_admin', 'system_admin']), async (req, res) => {
  try {
    const { id: employeeId } = req.params;
    const userId = req.user.userId;
    const { cycle_id, quarter, overall_rating, overall_comments, status, goal_ratings } = req.body;
    
    if (!cycle_id || !quarter) {
      return res.status(400).json({ error: 'cycle_id and quarter are required' });
    }
    
    const quarterNum = parseInt(quarter);
    if (quarterNum < 1 || quarterNum > 4) {
      return res.status(400).json({ error: 'quarter must be between 1 and 4' });
    }
    
    // Upsert quarterly self review with admin override
    const reviewResult = await query(
      `INSERT INTO quarterly_self_reviews (id, employee_id, cycle_id, quarter, overall_rating, overall_comments, status, submitted_at, admin_override, admin_override_by, admin_override_at, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, true, $8, NOW(), NOW(), NOW())
       ON CONFLICT (employee_id, cycle_id, quarter) DO UPDATE SET
         overall_rating = EXCLUDED.overall_rating,
         overall_comments = EXCLUDED.overall_comments,
         status = EXCLUDED.status,
         submitted_at = CASE WHEN EXCLUDED.status = 'submitted' THEN NOW() ELSE quarterly_self_reviews.submitted_at END,
         admin_override = true,
         admin_override_by = EXCLUDED.admin_override_by,
         admin_override_at = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [
        employeeId,
        cycle_id,
        quarterNum,
        overall_rating ?? null,
        overall_comments ?? null,
        status || 'pending',
        status === 'submitted' ? new Date() : null,
        userId
      ]
    );
    
    const selfReview = reviewResult.rows[0];
    
    // Update goal self ratings if provided
    if (goal_ratings && Array.isArray(goal_ratings)) {
      for (const rating of goal_ratings) {
        await query(
          `INSERT INTO goal_self_ratings (id, quarterly_review_id, goal_id, achievement, self_rating, evidence, achieved_value, target_value, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
           ON CONFLICT (quarterly_review_id, goal_id) DO UPDATE SET
             achievement = EXCLUDED.achievement,
             self_rating = EXCLUDED.self_rating,
             evidence = EXCLUDED.evidence,
             achieved_value = EXCLUDED.achieved_value,
             target_value = EXCLUDED.target_value,
             updated_at = NOW()
           RETURNING *`,
          [
            selfReview.id,
            rating.goal_id,
            rating.achievement ?? null,
            rating.self_rating ?? null,
            rating.evidence ?? null,
            rating.achieved_value ?? null,
            rating.target_value ?? null
          ]
        );
      }
    }
    
    res.json({ data: selfReview });
  } catch (error) {
    console.error('Admin override self review error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/employees/:id/manager-review/admin-override - Admin override for manager evaluation
router.put('/:id/manager-review/admin-override', authMiddleware, requireRole(['hr_admin', 'system_admin']), async (req, res) => {
  try {
    const { id: employeeId } = req.params;
    const userId = req.user.userId;
    const { cycle_id, quarter, reviewer_id, overall_comments, guidance, calculated_overall_rating, status, kpi_feedback } = req.body;
    
    if (!cycle_id || !quarter) {
      return res.status(400).json({ error: 'cycle_id and quarter are required' });
    }
    
    const quarterNum = parseInt(quarter);
    if (quarterNum < 1 || quarterNum > 4) {
      return res.status(400).json({ error: 'quarter must be between 1 and 4' });
    }
    
    // Use current user as reviewer if not provided
    const finalReviewerId = reviewer_id || userId;
    
    // Get employee record for reviewer_id (need to convert profile_id to employee_id)
    let reviewerEmployeeId = finalReviewerId;
    if (finalReviewerId === userId) {
      const empResult = await query(
        'SELECT id FROM employees WHERE profile_id = $1',
        [userId]
      );
      if (empResult.rows.length > 0) {
        reviewerEmployeeId = empResult.rows[0].id;
      }
    }
    
    // Upsert quarterly manager review with admin override
    const reviewResult = await query(
      `INSERT INTO quarterly_manager_reviews (id, employee_id, cycle_id, quarter, reviewer_id, overall_comments, guidance, calculated_overall_rating, status, approved_at, admin_override, admin_override_by, admin_override_at, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, NOW(), NOW(), NOW())
       ON CONFLICT (employee_id, cycle_id, quarter) DO UPDATE SET
         reviewer_id = EXCLUDED.reviewer_id,
         overall_comments = EXCLUDED.overall_comments,
         guidance = EXCLUDED.guidance,
         calculated_overall_rating = EXCLUDED.calculated_overall_rating,
         status = EXCLUDED.status,
         approved_at = CASE WHEN EXCLUDED.status = 'submitted' THEN NOW() ELSE quarterly_manager_reviews.approved_at END,
         admin_override = true,
         admin_override_by = EXCLUDED.admin_override_by,
         admin_override_at = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [
        employeeId,
        cycle_id,
        quarterNum,
        reviewerEmployeeId,
        overall_comments ?? null,
        guidance ?? null,
        calculated_overall_rating ?? null,
        status || 'pending',
        status === 'submitted' ? new Date() : null,
        userId
      ]
    );
    
    const managerReview = reviewResult.rows[0];
    
    // Update manager_evaluations table with quarterly rating
    if (calculated_overall_rating !== null && calculated_overall_rating !== undefined) {
      const quarterColumn = `q${quarterNum}_rating`;
      const existingEval = await query(
        `SELECT id FROM manager_evaluations WHERE employee_id = $1 AND cycle_id = $2`,
        [employeeId, cycle_id]
      );
      
      if (existingEval.rows.length > 0) {
        await query(
          `UPDATE manager_evaluations SET
            ${quarterColumn} = $1,
            evaluator_id = $2,
            updated_at = NOW()
           WHERE employee_id = $3 AND cycle_id = $4`,
          [calculated_overall_rating, reviewerEmployeeId, employeeId, cycle_id]
        );
      } else {
        await query(
          `INSERT INTO manager_evaluations (id, employee_id, cycle_id, evaluator_id, ${quarterColumn}, status, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), NOW())`,
          [employeeId, cycle_id, reviewerEmployeeId, calculated_overall_rating, status === 'submitted' ? 'in_progress' : 'pending']
        );
      }
    }
    
    // Update KPI feedback if provided
    if (kpi_feedback && Array.isArray(kpi_feedback)) {
      for (const feedback of kpi_feedback) {
        await query(
          `INSERT INTO quarterly_kpi_manager_feedback (id, manager_review_id, goal_id, rating, comments, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
           ON CONFLICT (manager_review_id, goal_id) DO UPDATE SET
             rating = EXCLUDED.rating,
             comments = EXCLUDED.comments,
             updated_at = NOW()
           RETURNING *`,
          [
            managerReview.id,
            feedback.goal_id,
            feedback.rating ?? null,
            feedback.comments ?? null
          ]
        );
      }
    }
    
    res.json({ data: managerReview });
  } catch (error) {
    console.error('Admin override manager review error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

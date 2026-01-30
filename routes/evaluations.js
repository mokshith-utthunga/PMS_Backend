import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { checkManagerOrDelegate } from './delegations.js';
import { normalizeRatings } from '../services/normalizationService.js';

const router = express.Router();

// ========== GOAL SELF RATINGS ==========

// GET /api/evaluations/goal-self-ratings
router.get('/goal-self-ratings', authMiddleware, async (req, res) => {
  try {
    const { quarterly_review_id, goal_id } = req.query;
    
    
    let sql = `
    SELECT 
      g.metric_type,
      s.*
    FROM goal_self_ratings s
    JOIN goals g ON g.id = s.goal_id
    WHERE 1=1
  `;
    const params = [];
    let idx = 1;

    if (quarterly_review_id) {
      sql += ` AND quarterly_review_id = $${idx++}`;
      params.push(quarterly_review_id);
    }
    if (goal_id) {
      sql += ` AND goal_id = $${idx++}`;
      params.push(goal_id);
    }

    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Get goal self ratings error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/evaluations/goal-self-ratings (single upsert)
router.post('/goal-self-ratings', authMiddleware, async (req, res) => {
  try {
    const { quarterly_review_id, goal_id, achievement, self_rating, evidence, achieved_value, target_value } = req.body;
    
    const result = await query(
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
        quarterly_review_id ?? null,
        goal_id ?? null,
        achievement ?? null,
        self_rating ?? null,
        evidence ?? null,
        achieved_value ?? null,
        target_value ?? null
      ]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Upsert goal self rating error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/evaluations/goal-self-ratings/bulk - Bulk upsert all ratings at once
router.post('/goal-self-ratings/bulk', authMiddleware, async (req, res) => {
  try {
    const { quarterly_review_id, ratings } = req.body;
    
    if (!ratings || !Array.isArray(ratings) || ratings.length === 0) {
      return res.json({ data: [] });
    }
    
    const results = [];
    for (const rating of ratings) {
      const result = await query(
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
          quarterly_review_id ?? null,
          rating.goal_id ?? null,
          rating.achievement ?? null,
          rating.self_rating ?? null,
          rating.evidence ?? null,
          rating.achieved_value ?? null,
          rating.target_value ?? null
        ]
      );
      if (result.rows[0]) {
        results.push(result.rows[0]);
      }
    }
    
    res.json({ data: results });
  } catch (error) {
    console.error('Bulk upsert goal self ratings error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/evaluations/goal-self-ratings/:id
router.put('/goal-self-ratings/:id', authMiddleware, async (req, res) => {
  try {
    const { achievement, self_rating, evidence, achieved_value, target_value } = req.body;
    
    const result = await query(
      `UPDATE goal_self_ratings SET
        achievement = COALESCE($1, achievement),
        self_rating = COALESCE($2, self_rating),
        evidence = COALESCE($3, evidence),
        achieved_value = COALESCE($4, achieved_value),
        target_value = COALESCE($5, target_value),
        updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [
        achievement ?? null,
        self_rating ?? null,
        evidence ?? null,
        achieved_value ?? null,
        target_value ?? null,
        req.params.id
      ]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Goal self rating not found' });
    }
    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Update goal self rating error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== QUARTERLY REVIEWS ==========

// GET /api/evaluations/quarterly-self-reviews
router.get('/quarterly-self-reviews', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, quarter } = req.query;
    
    let sql = 'SELECT * FROM quarterly_self_reviews WHERE 1=1';
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
    if (quarter && quarter !== 'null') {
      sql += ` AND quarter = $${idx++}`;
      params.push(quarter);
    }

    sql += ' ORDER BY quarter ASC';
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/evaluations/quarterly-self-reviews (upsert)
router.post('/quarterly-self-reviews', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, quarter, overall_rating, overall_comments, status } = req.body;
    
    const result = await query(
      `INSERT INTO quarterly_self_reviews (id, employee_id, cycle_id, quarter, overall_rating, overall_comments, status, submitted_at, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       ON CONFLICT (employee_id, cycle_id, quarter) DO UPDATE SET
         overall_rating = EXCLUDED.overall_rating,
         overall_comments = EXCLUDED.overall_comments,
         status = EXCLUDED.status,
         submitted_at = CASE WHEN EXCLUDED.status = 'submitted' THEN NOW() ELSE quarterly_self_reviews.submitted_at END,
         updated_at = NOW()
       RETURNING *`,
      [
        employee_id ?? null,
        cycle_id ?? null,
        quarter ?? null,
        overall_rating ?? null,
        overall_comments ?? null,
        status || 'pending',
        status === 'submitted' ? new Date() : null
      ]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== QUARTERLY KPI PROGRESS ==========

// GET /api/evaluations/quarterly-kpi-progress
router.get('/quarterly-kpi-progress', authMiddleware, async (req, res) => {
  try {
    const { quarterly_review_id } = req.query;
    
    let sql = 'SELECT * FROM quarterly_kpi_progress WHERE 1=1';
    const params = [];
    let idx = 1;

    if (quarterly_review_id) {
      sql += ` AND quarterly_review_id = $${idx++}`;
      params.push(quarterly_review_id);
    }

    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/evaluations/quarterly-kpi-progress (upsert)
router.post('/quarterly-kpi-progress', authMiddleware, async (req, res) => {
  try {
    const { quarterly_review_id, goal_id, progress_percentage, achievement_to_date, challenges, self_rating } = req.body;
    
    const result = await query(
      `INSERT INTO quarterly_kpi_progress (id, quarterly_review_id, goal_id, progress_percentage, achievement_to_date, challenges, self_rating, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (quarterly_review_id, goal_id) DO UPDATE SET
         progress_percentage = EXCLUDED.progress_percentage,
         achievement_to_date = EXCLUDED.achievement_to_date,
         challenges = EXCLUDED.challenges,
         self_rating = EXCLUDED.self_rating,
         updated_at = NOW()
       RETURNING *`,
      [
        quarterly_review_id ?? null,
        goal_id ?? null,
        progress_percentage ?? null,
        achievement_to_date ?? null,
        challenges ?? null,
        self_rating ?? null
      ]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/evaluations/quarterly-kpi-progress/bulk
router.post('/quarterly-kpi-progress/bulk', authMiddleware, async (req, res) => {
  try {
    const { quarterly_review_id, progress } = req.body;

    if (!progress || !Array.isArray(progress) || progress.length === 0) {
      return res.json({ data: [] });
    }

    const results = [];
    for (const item of progress) {
      const result = await query(
        `INSERT INTO quarterly_kpi_progress (id, quarterly_review_id, goal_id, progress_percentage, achievement_to_date, challenges, self_rating, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (quarterly_review_id, goal_id) DO UPDATE SET
           progress_percentage = EXCLUDED.progress_percentage,
           achievement_to_date = EXCLUDED.achievement_to_date,
           challenges = EXCLUDED.challenges,
           self_rating = EXCLUDED.self_rating,
           updated_at = NOW()
         RETURNING *`,
        [
          quarterly_review_id ?? null,
          item.goal_id ?? null,
          item.progress_percentage ?? null,
          item.achievement_to_date ?? null,
          item.challenges ?? null,
          item.self_rating ?? null
        ]
      );
      if (result.rows[0]) {
        results.push(result.rows[0]);
      }
    }

    res.json({ data: results });
  } catch (error) {
    console.error('Bulk upsert quarterly kpi progress error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/evaluations/quarterly-manager-reviews
router.get('/quarterly-manager-reviews', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, quarter } = req.query;
    
    let sql = 'SELECT * FROM quarterly_manager_reviews WHERE 1=1';
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
    if (quarter && quarter !== 'null') {
      sql += ` AND quarter = $${idx++}`;
      params.push(quarter);
    }

    sql += ' ORDER BY quarter ASC';
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/evaluations/quarterly-manager-reviews/count
router.get('/quarterly-manager-reviews/count', authMiddleware, async (req, res) => {
  try {
    const { cycle_id, reviewer_id, status } = req.query;
    
    let sql = 'SELECT COUNT(*) as count FROM quarterly_manager_reviews WHERE 1=1';
    const params = [];
    let idx = 1;

    if (cycle_id) {
      sql += ` AND cycle_id = $${idx++}`;
      params.push(cycle_id);
    }
    if (reviewer_id) {
      sql += ` AND reviewer_id = $${idx++}`;
      params.push(reviewer_id);
    }
    if (status) {
      sql += ` AND status = $${idx++}`;
      params.push(status);
    }

    const result = await query(sql, params);
    res.json({ count: parseInt(result.rows[0]?.count || 0) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/evaluations/quarterly-manager-reviews (upsert)
router.post('/quarterly-manager-reviews', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, quarter, reviewer_id, overall_comments, guidance, status, calculated_overall_rating } = req.body;
    
    // Check if user is manager or delegate
    if (employee_id && cycle_id && quarter) {
      const auth = await checkManagerOrDelegate(
        req.user.userId,
        employee_id,
        cycle_id,
        parseInt(quarter)
      );
      
      if (!auth.isAuthorized) {
        return res.status(403).json({ error: 'Not authorized to submit review for this employee' });
      }
    }
    
    // Upsert quarterly manager review
    const result = await query(
      `INSERT INTO quarterly_manager_reviews (id, employee_id, cycle_id, quarter, reviewer_id, overall_comments, guidance, calculated_overall_rating, status, approved_at, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
       ON CONFLICT (employee_id, cycle_id, quarter) DO UPDATE SET
         overall_comments = EXCLUDED.overall_comments,
         guidance = EXCLUDED.guidance,
         calculated_overall_rating = EXCLUDED.calculated_overall_rating,
         status = EXCLUDED.status,
         approved_at = CASE WHEN EXCLUDED.status = 'submitted' THEN NOW() ELSE quarterly_manager_reviews.approved_at END,
         updated_at = NOW()
       RETURNING *`,
      [
        employee_id ?? null,
        cycle_id ?? null,
        quarter ?? null,
        reviewer_id ?? null,
        overall_comments ?? null,
        guidance ?? null,
        calculated_overall_rating ?? null,
        status || 'pending',
        status === 'submitted' ? new Date() : null
      ]
    );

    // Also upsert into manager_evaluations table with quarterly rating
    if (employee_id && cycle_id && reviewer_id && quarter) {
      const quarterNum = parseInt(quarter);
      const quarterRating = calculated_overall_rating ?? null;
      
      // Build dynamic column name for the quarter rating
      const quarterColumn = `q${quarterNum}_rating`;
      
      // Check if manager_evaluation exists for this employee/cycle
      const existingEval = await query(
        `SELECT id, q1_rating, q2_rating, q3_rating, q4_rating FROM manager_evaluations 
         WHERE employee_id = $1 AND cycle_id = $2`,
        [employee_id, cycle_id]
      );

      if (existingEval.rows.length > 0) {
        // Update existing row with the quarter rating
        await query(
          `UPDATE manager_evaluations SET
            ${quarterColumn} = $1,
            evaluator_id = $2,
            status = CASE 
              WHEN $3 = 'submitted' AND status = 'pending' THEN 'in_progress'
              ELSE status 
            END,
            updated_at = NOW()
           WHERE employee_id = $4 AND cycle_id = $5`,
          [
            quarterRating,
            reviewer_id,
            status,
            employee_id,
            cycle_id
          ]
        );

        // Recalculate overall rating if all quarters have ratings
        const updatedEval = await query(
          `SELECT q1_rating, q2_rating, q3_rating, q4_rating FROM manager_evaluations 
           WHERE employee_id = $1 AND cycle_id = $2`,
          [employee_id, cycle_id]
        );
        
        if (updatedEval.rows.length > 0) {
          const row = updatedEval.rows[0];
          const ratings = [row.q1_rating, row.q2_rating, row.q3_rating, row.q4_rating].filter(r => r !== null);
          if (ratings.length > 0) {
            const avgRating = ratings.reduce((a, b) => Number(a) + Number(b), 0) / ratings.length;
            await query(
              `UPDATE manager_evaluations SET calculated_overall_rating = $1, updated_at = NOW()
               WHERE employee_id = $2 AND cycle_id = $3`,
              [avgRating.toFixed(2), employee_id, cycle_id]
            );
          }
        }
      } else {
        // Create new manager_evaluation with the quarter rating
        const insertSql = `
          INSERT INTO manager_evaluations (
            id, employee_id, cycle_id, evaluator_id, 
            ${quarterColumn}, status, created_at, updated_at
          )
          VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), NOW())
        `;
        await query(insertSql, [
          employee_id,
          cycle_id,
          reviewer_id,
          quarterRating,
          status === 'submitted' ? 'in_progress' : 'pending'
        ]);
      }
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Quarterly manager review upsert error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== QUARTERLY KPI MANAGER FEEDBACK ==========

// GET /api/evaluations/quarterly-kpi-manager-feedback
router.get('/quarterly-kpi-manager-feedback', authMiddleware, async (req, res) => {
  try {
    const { manager_review_id } = req.query;
    
    let sql = 'SELECT * FROM quarterly_kpi_manager_feedback WHERE 1=1';
    const params = [];
    let idx = 1;

    if (manager_review_id) {
      sql += ` AND manager_review_id = $${idx++}`;
      params.push(manager_review_id);
    }

    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/evaluations/quarterly-kpi-manager-feedback (upsert)
router.post('/quarterly-kpi-manager-feedback', authMiddleware, async (req, res) => {
  try {
    const { manager_review_id, goal_id, rating, comments, manager_achieved_value, progress_percentage } = req.body;
    
    const result = await query(
      `INSERT INTO quarterly_kpi_manager_feedback (id, manager_review_id, goal_id, rating, comments, progress_percentage, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (manager_review_id, goal_id) DO UPDATE SET
         rating = EXCLUDED.rating,
         comments = EXCLUDED.comments,
         progress_percentage = EXCLUDED.progress_percentage,
         updated_at = NOW()
       RETURNING *`,
      [
        manager_review_id ?? null,
        goal_id ?? null,
        rating ?? null,
        comments ?? null,
        progress_percentage ?? null
      ]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/evaluations/quarterly-kpi-manager-feedback/bulk
router.post('/quarterly-kpi-manager-feedback/bulk', authMiddleware, async (req, res) => {
  try {
    const { manager_review_id, ratings } = req.body;

    if (!ratings || !Array.isArray(ratings) || ratings.length === 0) {
      return res.json({ data: [] });
    }

    const results = [];
    for (const item of ratings) {
      const result = await query(
        `INSERT INTO quarterly_kpi_manager_feedback (id, manager_review_id, goal_id, rating, comments, progress_percentage, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (manager_review_id, goal_id) DO UPDATE SET
           rating = EXCLUDED.rating,
           comments = EXCLUDED.comments,
           progress_percentage = EXCLUDED.progress_percentage,
           updated_at = NOW()
         RETURNING *`,
        [
          manager_review_id ?? null,
          item.goal_id ?? null,
          item.rating ?? null,
          item.comments ?? null,
          item.progress_percentage ?? null
        ]
      );
      if (result.rows[0]) {
        results.push(result.rows[0]);
      }
    }

    res.json({ data: results });
  } catch (error) {
    console.error('Bulk upsert quarterly kpi manager feedback error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== COMPETENCY RATINGS ==========

// GET /api/evaluations/competency-self-ratings
router.get('/competency-self-ratings', authMiddleware, async (req, res) => {
  try {
    const { self_evaluation_id } = req.query;
    
    let sql = 'SELECT * FROM competency_self_ratings WHERE 1=1';
    const params = [];
    let idx = 1;

    if (self_evaluation_id) {
      sql += ` AND self_evaluation_id = $${idx++}`;
      params.push(self_evaluation_id);
    }

    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/evaluations/competency-self-ratings (upsert)
router.post('/competency-self-ratings', authMiddleware, async (req, res) => {
  try {
    const { self_evaluation_id, competency_id, rating, comments } = req.body;
    
    const result = await query(
      `INSERT INTO competency_self_ratings (id, self_evaluation_id, competency_id, rating, comments, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())
       ON CONFLICT (self_evaluation_id, competency_id) DO UPDATE SET
         rating = EXCLUDED.rating,
         comments = EXCLUDED.comments
       RETURNING *`,
      [
        self_evaluation_id ?? null,
        competency_id ?? null,
        rating ?? null,
        comments ?? null
      ]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== HR REVIEW WORKFLOW ==========

// GET /api/evaluations/hr-pending-reviews
// Get manager reviews pending HR approval (submitted but not HR approved)
router.get('/hr-pending-reviews', authMiddleware, async (req, res) => {
  try {
    const { cycle_id } = req.query;
    
    let sql = `
      SELECT 
        qmr.*,
        e.full_name as employee_name,
        e.emp_code as employee_code,
        m.full_name as manager_name,
        m.emp_code as manager_code,
        pc.name as cycle_name
      FROM quarterly_manager_reviews qmr
      INNER JOIN employees e ON e.id = qmr.employee_id
      INNER JOIN employees m ON m.id = qmr.reviewer_id
      INNER JOIN performance_cycles pc ON pc.id = qmr.cycle_id
      WHERE qmr.status = 'submitted' 
        AND qmr.hr_approved_at IS NULL
    `;
    const params = [];
    let idx = 1;

    if (cycle_id) {
      sql += ` AND qmr.cycle_id = $${idx++}`;
      params.push(cycle_id);
    }

    sql += ' ORDER BY qmr.created_at DESC';
    
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Get HR pending reviews error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/evaluations/hr-approve-review
// HR approves a manager review and releases it to employee
router.post('/hr-approve-review', authMiddleware, async (req, res) => {
  try {
    const { manager_review_id } = req.body;
    const userId = req.user?.userId;

    if (!manager_review_id) {
      return res.status(400).json({ error: 'manager_review_id is required' });
    }

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Update quarterly_manager_reviews with HR approval
    const result = await query(
      `UPDATE quarterly_manager_reviews 
       SET hr_approved_at = NOW(),
           hr_approved_by = $1,
           released_at = NOW(),
           updated_at = NOW()
       WHERE id = $2 AND status = 'submitted' AND hr_approved_at IS NULL
       RETURNING *`,
      [userId, manager_review_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Review not found or already approved' });
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('HR approve review error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/evaluations/hr-reject-review
// HR rejects a manager review (sends back to manager)
router.post('/hr-reject-review', authMiddleware, async (req, res) => {
  try {
    const { manager_review_id, rejection_reason } = req.body;

    if (!manager_review_id || !rejection_reason) {
      return res.status(400).json({ error: 'manager_review_id and rejection_reason are required' });
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(manager_review_id)) {
      return res.status(400).json({ error: 'Invalid manager_review_id format. Expected UUID.' });
    }

    // Update status back to pending for manager to revise and store rejection reason
    const result = await query(
      `UPDATE quarterly_manager_reviews 
       SET status = 'pending',
           hr_rejection_reason = $2,
           hr_approved_at = NULL,
           hr_approved_by = NULL,
           released_at = NULL,
           updated_at = NOW()
       WHERE id = $1 AND status = 'submitted'
       RETURNING *`,
      [manager_review_id, rejection_reason]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Review not found or already processed' });
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('HR reject review error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/evaluations/employee-reject-rating
// Employee rejects their rating
router.post('/employee-reject-rating', authMiddleware, async (req, res) => {
  try {
    const { manager_review_id, rejection_reason, cycle_id, quarter } = req.body;
    const userId = req.user?.userId;
    
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!manager_review_id || !rejection_reason || !cycle_id || !quarter) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Get employee_id from user
    const empResult = await query(
      'SELECT id FROM employees WHERE profile_id = $1',
      [userId]
    );

    if (empResult.rows.length === 0) {
      return res.status(404).json({ error: 'Employee record not found' });
    }

    const employeeId = empResult.rows[0].id;

    // Create rating rejection
    const rejectionResult = await query(
      `INSERT INTO rating_rejections 
       (id, employee_id, cycle_id, quarter, manager_review_id, rejection_reason, status, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'pending', NOW(), NOW())
       ON CONFLICT (employee_id, cycle_id, quarter) DO UPDATE SET
         rejection_reason = EXCLUDED.rejection_reason,
         status = 'pending',
         updated_at = NOW()
       RETURNING *`,
      [employeeId, cycle_id, quarter, manager_review_id, rejection_reason]
    );

    // Mark employee_rejected_at in quarterly_manager_reviews
    await query(
      `UPDATE quarterly_manager_reviews 
       SET employee_rejected_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [manager_review_id]
    );

    res.json({ data: rejectionResult.rows[0] });
  } catch (error) {
    console.error('Employee reject rating error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/evaluations/employee-accept-rating
// Employee accepts their rating
router.post('/employee-accept-rating', authMiddleware, async (req, res) => {
  try {
    const { manager_review_id } = req.body;
    const userId = req.user?.userId;
    
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!manager_review_id) {
      return res.status(400).json({ error: 'manager_review_id is required' });
    }

    // Get employee_id from user
    const empResult = await query(
      'SELECT id FROM employees WHERE profile_id = $1',
      [userId]
    );

    if (empResult.rows.length === 0) {
      return res.status(404).json({ error: 'Employee record not found' });
    }

    // Mark employee_acknowledged_at in quarterly_manager_reviews
    const result = await query(
      `UPDATE quarterly_manager_reviews 
       SET employee_acknowledged_at = NOW(),
           employee_rejected_at = NULL,
           updated_at = NOW()
       WHERE id = $1 AND hr_approved_at IS NOT NULL
       RETURNING *`,
      [manager_review_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Review not found or not yet approved by HR' });
    }

    // Update any pending rejection to resolved
    await query(
      `UPDATE rating_rejections 
       SET status = 'resolved',
           resolved_at = NOW(),
           resolved_by = $1,
           updated_at = NOW()
       WHERE manager_review_id = $2 AND status = 'pending'`,
      [userId, manager_review_id]
    );

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Employee accept rating error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== YEAR-END EVALUATION ==========

// GET /api/evaluations/year-end-evaluation
// Get year-end evaluation for an employee in a cycle
router.get('/year-end-evaluation', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id } = req.query;
    
    if (!employee_id || !cycle_id) {
      return res.status(400).json({ error: 'employee_id and cycle_id are required' });
    }
    
    const result = await query(
      `SELECT * FROM manager_evaluations 
       WHERE employee_id = $1 AND cycle_id = $2`,
      [employee_id, cycle_id]
    );
    
    if (result.rows.length === 0) {
      return res.json({ data: null });
    }
    
    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Get year-end evaluation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/evaluations/year-end-evaluation
// Create or update year-end evaluation for an employee
router.post('/year-end-evaluation', authMiddleware, async (req, res) => {
  try {
    const { 
      employee_id, 
      cycle_id, 
      evaluator_id,
      overall_rating,
      overall_comments,
      potential_rating,
      development_recommendations,
      status 
    } = req.body;
    
    if (!employee_id || !cycle_id || !evaluator_id) {
      return res.status(400).json({ error: 'employee_id, cycle_id, and evaluator_id are required' });
    }
    
    // Check if record exists
    const existing = await query(
      `SELECT id FROM manager_evaluations WHERE employee_id = $1 AND cycle_id = $2`,
      [employee_id, cycle_id]
    );
    
    let result;
    if (existing.rows.length > 0) {
      // Update existing record
      result = await query(
        `UPDATE manager_evaluations SET
          evaluator_id = $1,
          overall_rating = $2,
          overall_comments = $3,
          potential_rating = $4,
          development_recommendations = $5,
          status = $6,
          submitted_at = CASE WHEN $6 = 'submitted' THEN NOW() ELSE submitted_at END,
          updated_at = NOW()
         WHERE employee_id = $7 AND cycle_id = $8
         RETURNING *`,
        [
          evaluator_id,
          overall_rating ?? null,
          overall_comments ?? null,
          potential_rating ?? null,
          development_recommendations ?? null,
          status || 'pending',
          employee_id,
          cycle_id
        ]
      );
    } else {
      // Create new record
      result = await query(
        `INSERT INTO manager_evaluations (
          id, employee_id, cycle_id, evaluator_id,
          overall_rating, overall_comments, potential_rating, development_recommendations,
          status, submitted_at, created_at, updated_at
        )
        VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8,
          CASE WHEN $8 = 'submitted' THEN NOW() ELSE NULL END,
          NOW(), NOW()
        )
        RETURNING *`,
        [
          employee_id,
          cycle_id,
          evaluator_id,
          overall_rating ?? null,
          overall_comments ?? null,
          potential_rating ?? null,
          development_recommendations ?? null,
          status || 'pending'
        ]
      );
    }
    
    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Upsert year-end evaluation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== YEAR-END HR REVIEW WORKFLOW ==========

// GET /api/evaluations/hr-pending-year-end-reviews
// Get year-end manager evaluations pending HR approval (status = 'submitted' and not yet released)
router.get('/hr-pending-year-end-reviews', authMiddleware, async (req, res) => {
  try {
    const { cycle_id } = req.query;
    
    let sql = `
      SELECT 
        me.*,
        e.full_name as employee_name,
        e.emp_code as employee_code,
        e.department,
        m.full_name as manager_name,
        m.emp_code as manager_code,
        pc.name as cycle_name
      FROM manager_evaluations me
      INNER JOIN employees e ON e.id = me.employee_id
      LEFT JOIN employees m ON m.id = me.evaluator_id
      INNER JOIN performance_cycles pc ON pc.id = me.cycle_id
      WHERE me.status = 'submitted' 
        AND me.released_at IS NULL
    `;
    const params = [];
    let idx = 1;

    if (cycle_id) {
      sql += ` AND me.cycle_id = $${idx++}`;
      params.push(cycle_id);
    }

    sql += ' ORDER BY me.created_at DESC';
    
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Get HR pending year-end reviews error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/evaluations/hr-approve-year-end-review
// HR approves a year-end manager evaluation and releases it to employee
router.post('/hr-approve-year-end-review', authMiddleware, async (req, res) => {
  try {
    const { manager_evaluation_id } = req.body;

    if (!manager_evaluation_id) {
      return res.status(400).json({ error: 'manager_evaluation_id is required' });
    }

    // Update manager_evaluations - set released_at to mark HR approval
    const result = await query(
      `UPDATE manager_evaluations 
       SET released_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND status = 'submitted' AND released_at IS NULL
       RETURNING *`,
      [manager_evaluation_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Evaluation not found or already approved' });
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('HR approve year-end review error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/evaluations/hr-reject-year-end-review
// HR rejects a year-end manager evaluation (sends back to manager)
router.post('/hr-reject-year-end-review', authMiddleware, async (req, res) => {
  try {
    const { manager_evaluation_id, rejection_reason } = req.body;

    if (!manager_evaluation_id || !rejection_reason) {
      return res.status(400).json({ error: 'manager_evaluation_id and rejection_reason are required' });
    }

    // Update status back to pending for manager to revise
    // Store rejection reason in overall_comments or development_recommendations temporarily
    const result = await query(
      `UPDATE manager_evaluations 
       SET status = 'pending',
           released_at = NULL,
           updated_at = NOW()
       WHERE id = $1 AND status = 'submitted'
       RETURNING *`,
      [manager_evaluation_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Evaluation not found or already processed' });
    }

    res.json({ data: result.rows[0], rejection_reason });
  } catch (error) {
    console.error('HR reject year-end review error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/evaluations/employee-accept-year-end-rating
// Employee accepts their year-end rating
router.post('/employee-accept-year-end-rating', authMiddleware, async (req, res) => {
  try {
    const { manager_evaluation_id } = req.body;
    const userId = req.user?.userId;
    
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!manager_evaluation_id) {
      return res.status(400).json({ error: 'manager_evaluation_id is required' });
    }

    // Get employee_id from user
    const empResult = await query(
      'SELECT id FROM employees WHERE profile_id = $1',
      [userId]
    );

    if (empResult.rows.length === 0) {
      return res.status(404).json({ error: 'Employee record not found' });
    }

    // Mark acknowledged_at in manager_evaluations
    const result = await query(
      `UPDATE manager_evaluations 
       SET acknowledged_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND released_at IS NOT NULL
       RETURNING *`,
      [manager_evaluation_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Evaluation not found or not yet released by HR' });
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Employee accept year-end rating error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/evaluations/employee-reject-year-end-rating
// Employee rejects their year-end rating
router.post('/employee-reject-year-end-rating', authMiddleware, async (req, res) => {
  try {
    const { manager_evaluation_id, rejection_reason, cycle_id } = req.body;
    const userId = req.user?.userId;
    
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!manager_evaluation_id || !rejection_reason || !cycle_id) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Get employee_id from user
    const empResult = await query(
      'SELECT id FROM employees WHERE profile_id = $1',
      [userId]
    );

    if (empResult.rows.length === 0) {
      return res.status(404).json({ error: 'Employee record not found' });
    }

    const employeeId = empResult.rows[0].id;

    // Create rating rejection for year-end (quarter = NULL)
    const rejectionResult = await query(
      `INSERT INTO rating_rejections 
       (id, employee_id, cycle_id, quarter, manager_review_id, rejection_reason, status, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, NULL, $3, $4, 'pending', NOW(), NOW())
       ON CONFLICT (employee_id, cycle_id, quarter) DO UPDATE SET
         rejection_reason = EXCLUDED.rejection_reason,
         status = 'pending',
         updated_at = NOW()
       RETURNING *`,
      [employeeId, cycle_id, manager_evaluation_id, rejection_reason]
    );

    // Store acknowledgment_comments with rejection reason
    await query(
      `UPDATE manager_evaluations 
       SET acknowledgment_comments = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [manager_evaluation_id, `Rejected: ${rejection_reason}`]
    );

    res.json({ data: rejectionResult.rows[0] });
  } catch (error) {
    console.error('Employee reject year-end rating error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/evaluations/rating-rejections
// Get rating rejections (for HR/Admin/BU Head)
router.get('/rating-rejections', authMiddleware, async (req, res) => {
  try {
    const { cycle_id, status } = req.query;
    
    let sql = `
      SELECT 
        rr.*,
        e.full_name as employee_name,
        e.emp_code as employee_code,
        pc.name as cycle_name,
        qmr.calculated_overall_rating,
        qmr.overall_comments as manager_comments
      FROM rating_rejections rr
      INNER JOIN employees e ON e.id = rr.employee_id
      INNER JOIN performance_cycles pc ON pc.id = rr.cycle_id
      INNER JOIN quarterly_manager_reviews qmr ON qmr.id = rr.manager_review_id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (cycle_id) {
      sql += ` AND rr.cycle_id = $${idx++}`;
      params.push(cycle_id);
    }
    if (status) {
      sql += ` AND rr.status = $${idx++}`;
      params.push(status);
    }

    sql += ' ORDER BY rr.created_at DESC';
    
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Get rating rejections error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== NORMALIZED RATINGS WORKFLOW ==========

// POST /api/hr/normalize?quarter=QX&cycle_id=UUID
// Normalize ratings for a quarter using Box-Cox transform
// Optional body parameters: managerWeight, gradeWeight, minGroupSize, useWinsorization, maxChangeFromRaw
router.post('/hr/normalize', authMiddleware, requireRole(['hr_admin', 'hrbp', 'system_admin']), async (req, res) => {
  try {
    const { quarter, cycle_id } = req.query;
    const userId = req.user?.userId;
    
    if (!quarter || !cycle_id) {
      return res.status(400).json({ error: 'quarter and cycle_id are required' });
    }
    
    const quarterNum = parseInt(quarter);
    if (quarterNum < 1 || quarterNum > 4) {
      return res.status(400).json({ error: 'quarter must be between 1 and 4' });
    }
    
    // Extract optional configuration from request body
    const config = {};
    if (req.body.managerWeight !== undefined) {
      config.managerWeight = parseFloat(req.body.managerWeight);
      config.gradeWeight = 1 - config.managerWeight; // Ensure weights sum to 1
    }
    if (req.body.minGroupSize !== undefined) {
      config.minGroupSize = parseInt(req.body.minGroupSize);
    }
    if (req.body.useWinsorization !== undefined) {
      config.useWinsorization = req.body.useWinsorization === true || req.body.useWinsorization === 'true';
    }
    if (req.body.maxChangeFromRaw !== undefined) {
      config.maxChangeFromRaw = parseFloat(req.body.maxChangeFromRaw);
    }
    
    console.log(`Starting normalization for quarter ${quarterNum}, cycle ${cycle_id}`, config);
    const result = await normalizeRatings(quarterNum, cycle_id, userId, config);
    console.log(`Normalization completed:`, result);
    res.json({ data: result });
  } catch (error) {
    console.error('Normalize ratings error:', error);
    res.status(500).json({ error: error.message || 'Failed to normalize ratings' });
  }
});

// GET /api/hr/normalized-ratings?quarter=QX&cycle_id=UUID&status=...
// Get normalized ratings with filters
router.get('/hr/normalized-ratings', authMiddleware, requireRole(['hr_admin', 'hrbp', 'system_admin']), async (req, res) => {
  try {
    const { quarter, cycle_id, status } = req.query;
    
    let sql = `
      SELECT 
        nr.*,
        e.full_name as employee_name,
        e.emp_code as employee_code,
        e.grade,
        m.full_name as manager_name,
        m.emp_code as manager_code,
        p.full_name as updated_by_hr_name
      FROM normalized_ratings nr
      JOIN employees e ON e.id = nr.employee_id
      JOIN employees m ON m.id = nr.manager_id
      LEFT JOIN profiles p ON p.id = nr.updated_by_hr
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;
    
    if (cycle_id) {
      sql += ` AND nr.performance_cycle_id = $${idx++}`;
      params.push(cycle_id);
    }
    if (quarter) {
      sql += ` AND nr.quarter = $${idx++}`;
      params.push(parseInt(quarter));
    }
    if (status) {
      sql += ` AND nr.status = $${idx++}`;
      params.push(status);
    }
    
    sql += ' ORDER BY nr.updated_at DESC';
    
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Get normalized ratings error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/hr/send-to-manager
// Send normalized ratings to manager for review
router.post('/hr/send-to-manager', authMiddleware, requireRole(['hr_admin', 'hrbp', 'system_admin']), async (req, res) => {
  try {
    const { employeeIds, quarter, cycleId } = req.body;
    const userId = req.user?.userId;
    
    if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({ error: 'employeeIds array is required' });
    }
    if (!quarter || !cycleId) {
      return res.status(400).json({ error: 'quarter and cycleId are required' });
    }
    
    // Update status to SENT_TO_MANAGER
    const placeholders = employeeIds.map((_, i) => `$${i + 1}`).join(', ');
    const updateQuery = `
      UPDATE normalized_ratings
      SET status = 'SENT_TO_MANAGER',
          updated_at = NOW()
      WHERE employee_id IN (${placeholders})
        AND performance_cycle_id = $${employeeIds.length + 1}
        AND quarter = $${employeeIds.length + 2}
        AND status IN ('DRAFT', 'REJECTED')
      RETURNING *
    `;
    const updateParams = [...employeeIds, cycleId, parseInt(quarter)];
    const updateResult = await query(updateQuery, updateParams);
    
    // Log to history
    for (const row of updateResult.rows) {
      await query(
        `INSERT INTO rating_review_history (employee_id, quarter, cycle_id, old_value, new_value, action, acted_by)
         VALUES ($1, $2, $3, $4, $5, 'SEND', $6)`,
        [row.employee_id, row.quarter, row.performance_cycle_id, row.final_normalized_rating, row.final_normalized_rating, userId]
      );
    }
    
    res.json({ data: updateResult.rows, count: updateResult.rows.length });
  } catch (error) {
    console.error('Send to manager error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/manager/review
// Manager accepts or rejects normalized rating
router.post('/manager/review', authMiddleware, async (req, res) => {
  try {
    const { employeeId, quarter, cycleId, action } = req.body;
    const userId = req.user?.userId;
    
    if (!employeeId || !quarter || !cycleId || !action) {
      return res.status(400).json({ error: 'employeeId, quarter, cycleId, and action are required' });
    }
    
    if (!['ACCEPT', 'REJECT'].includes(action)) {
      return res.status(400).json({ error: 'action must be ACCEPT or REJECT' });
    }
    
    // Verify manager has access to this employee
    const managerCheck = await query(
      `SELECT nr.id, nr.final_normalized_rating, nr.status
       FROM normalized_ratings nr
       JOIN employees e ON e.id = nr.employee_id
       JOIN employees m ON m.id = nr.manager_id
       JOIN profiles p ON p.id = m.profile_id
       WHERE nr.employee_id = $1
         AND nr.performance_cycle_id = $2
         AND nr.quarter = $3
         AND nr.status = 'SENT_TO_MANAGER'
         AND p.id = $4`,
      [employeeId, cycleId, parseInt(quarter), userId]
    );
    
    if (managerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Not authorized or rating not found' });
    }
    
    const rating = managerCheck.rows[0];
    const newStatus = action === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';
    
    // Update status
    const updateResult = await query(
      `UPDATE normalized_ratings
       SET status = $1, updated_at = NOW()
       WHERE employee_id = $2
         AND performance_cycle_id = $3
         AND quarter = $4
         AND status = 'SENT_TO_MANAGER'
       RETURNING *`,
      [newStatus, employeeId, cycleId, parseInt(quarter)]
    );
    
    if (updateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Rating not found or already processed' });
    }
    
    // Log to history
    await query(
      `INSERT INTO rating_review_history (employee_id, quarter, cycle_id, old_value, new_value, action, acted_by)
       VALUES ($1, $2, $3, $4, $4, $5, $6)`,
      [employeeId, parseInt(quarter), cycleId, rating.final_normalized_rating, action, userId]
    );
    
    res.json({ data: updateResult.rows[0] });
  } catch (error) {
    console.error('Manager review error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/manager/normalized-ratings?manager_id=UUID&quarter=QX&cycle_id=UUID
// Get normalized ratings for manager's team
router.get('/manager/normalized-ratings', authMiddleware, async (req, res) => {
  try {
    const { manager_id, quarter, cycle_id } = req.query;
    const userId = req.user?.userId;
    
    // Verify manager access
    let managerId = manager_id;
    if (!managerId) {
      // Get manager_id from current user
      const empResult = await query(
        'SELECT id FROM employees WHERE profile_id = $1',
        [userId]
      );
      if (empResult.rows.length === 0) {
        return res.status(404).json({ error: 'Employee record not found' });
      }
      managerId = empResult.rows[0].id;
    }
    
    let sql = `
      SELECT 
        nr.*,
        e.full_name as employee_name,
        e.emp_code as employee_code,
        e.grade
      FROM normalized_ratings nr
      JOIN employees e ON e.id = nr.employee_id
      WHERE nr.manager_id = $1
        AND nr.status = 'SENT_TO_MANAGER'
    `;
    const params = [managerId];
    let idx = 2;
    
    if (cycle_id) {
      sql += ` AND nr.performance_cycle_id = $${idx++}`;
      params.push(cycle_id);
    }
    if (quarter) {
      sql += ` AND nr.quarter = $${idx++}`;
      params.push(parseInt(quarter));
    }
    
    sql += ' ORDER BY e.full_name';
    
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Get manager normalized ratings error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/hr/publish
// Publish normalized ratings (make visible to employees)
router.post('/hr/publish', authMiddleware, requireRole(['hr_admin', 'hrbp', 'system_admin']), async (req, res) => {
  try {
    const { employeeIds, quarter, cycleId } = req.body;
    const userId = req.user?.userId;
    
    if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({ error: 'employeeIds array is required' });
    }
    if (!quarter || !cycleId) {
      return res.status(400).json({ error: 'quarter and cycleId are required' });
    }
    
    // Update status to PUBLISHED and copy to quarterly_manager_reviews
    const placeholders = employeeIds.map((_, i) => `$${i + 1}`).join(', ');
    const updateQuery = `
      UPDATE normalized_ratings
      SET status = 'PUBLISHED',
          updated_at = NOW()
      WHERE employee_id IN (${placeholders})
        AND performance_cycle_id = $${employeeIds.length + 1}
        AND quarter = $${employeeIds.length + 2}
        AND status = 'ACCEPTED'
      RETURNING *
    `;
    const updateParams = [...employeeIds, cycleId, parseInt(quarter)];
    const updateResult = await query(updateQuery, updateParams);
    
    // Copy final_normalized_rating to quarterly_manager_reviews.calculated_overall_rating
    // Also set hr_approved_at so employees can see the rating
    for (const row of updateResult.rows) {
      await query(
        `UPDATE quarterly_manager_reviews
         SET calculated_overall_rating = $1,
             hr_approved_at = NOW(),
             hr_approved_by = $5,
             updated_at = NOW()
         WHERE employee_id = $2
           AND cycle_id = $3
           AND quarter = $4`,
        [row.final_normalized_rating, row.employee_id, row.performance_cycle_id, row.quarter, userId]
      );
      
      // Log to history
      await query(
        `INSERT INTO rating_review_history (employee_id, quarter, cycle_id, old_value, new_value, action, acted_by)
         VALUES ($1, $2, $3, $4, $5, 'PUBLISH', $6)`,
        [row.employee_id, row.quarter, row.performance_cycle_id, row.final_normalized_rating, row.final_normalized_rating, userId]
      );
    }
    
    res.json({ data: updateResult.rows, count: updateResult.rows.length });
  } catch (error) {
    console.error('Publish ratings error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/hr/normalized-rating/:id
// Update normalized rating (for REJECTED status)
router.put('/hr/normalized-rating/:id', authMiddleware, requireRole(['hr_admin', 'hrbp', 'system_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { final_normalized_rating } = req.body;
    const userId = req.user?.userId;
    
    if (final_normalized_rating === undefined || final_normalized_rating === null) {
      return res.status(400).json({ error: 'final_normalized_rating is required' });
    }
    
    // Get current rating
    const currentResult = await query(
      'SELECT * FROM normalized_ratings WHERE id = $1 AND status = $2',
      [id, 'REJECTED']
    );
    
    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Rating not found or not in REJECTED status' });
    }
    
    const current = currentResult.rows[0];
    const oldValue = current.final_normalized_rating;
    
    // Update rating and reset status to DRAFT
    const updateResult = await query(
      `UPDATE normalized_ratings
       SET final_normalized_rating = $1,
           status = 'DRAFT',
           updated_by_hr = $2,
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [final_normalized_rating, userId, id]
    );
    
    // Log to history
    await query(
      `INSERT INTO rating_review_history (employee_id, quarter, cycle_id, old_value, new_value, action, acted_by)
       VALUES ($1, $2, $3, $4, $5, 'EDIT', $6)`,
      [current.employee_id, current.quarter, current.performance_cycle_id, oldValue, final_normalized_rating, userId]
    );
    
    res.json({ data: updateResult.rows[0] });
  } catch (error) {
    console.error('Update normalized rating error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

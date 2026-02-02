import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { normalizeRatings } from '../services/normalizationService.js';
import { applyCalibration } from '../services/calibrationService.js';
import { checkManagerOrDelegate } from './delegations.js';

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

// ========== QUARTERLY SELF REVIEWS ==========

// GET /api/evaluations/quarterly-self-reviews
router.get('/quarterly-self-reviews', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, quarter, period_type, transition_id } = req.query;
    
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
    if (quarter) {
      sql += ` AND quarter = $${idx++}`;
      params.push(parseInt(quarter));
    }
    if (period_type) {
      sql += ` AND period_type = $${idx++}::period_type`;
      params.push(period_type);
    }
    if (transition_id) {
      sql += ` AND transition_id = $${idx++}`;
      params.push(transition_id);
    }
    
    sql += ' ORDER BY quarter ASC, created_at DESC';
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching quarterly self reviews:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/evaluations/quarterly-self-reviews
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

// ========== QUARTERLY MANAGER REVIEWS ==========

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
    const { manager_review_id, goal_id } = req.query;
    
    let sql = 'SELECT * FROM quarterly_kpi_manager_feedback WHERE 1=1';
    const params = [];
    let idx = 1;

    if (manager_review_id) {
      sql += ` AND manager_review_id = $${idx++}`;
      params.push(manager_review_id);
    }
    if (goal_id) {
      sql += ` AND goal_id = $${idx++}`;
      params.push(goal_id);
    }

    sql += ' ORDER BY created_at DESC';
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching quarterly KPI manager feedback:', error);
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
      JOIN employees e ON e.id = qmr.employee_id
      LEFT JOIN employees m ON m.emp_code = e.manager_code
      LEFT JOIN performance_cycles pc ON pc.id = qmr.cycle_id
      WHERE qmr.status = 'submitted' 
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
    console.error('Error fetching HR pending reviews:', error);
    res.status(500).json({ error: error.message });
  }
});

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

// POST /api/evaluations/hr/normalize
// Normalize ratings for a quarter using Box-Cox transform
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
    try {
      const result = await normalizeRatings(quarterNum, cycle_id, userId, config);
      console.log(`Normalization completed:`, result);
      
      // If no ratings were processed, provide more detailed error message
      if (result.processed === 0) {
        console.warn(`Normalization returned 0 processed ratings. Details:`, result);
        res.status(200).json({ 
          data: result,
          warning: result.message || 'No ratings were processed. Check server logs for details.'
        });
      } else {
        res.json({ data: result });
      }
    } catch (error) {
      console.error('Normalization error:', error);
      res.status(500).json({ 
        error: error.message,
        details: 'Check server console logs for more information about why normalization failed.'
      });
    }
  } catch (error) {
    console.error('Normalize ratings error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/evaluations/hr/calibrate
// Apply bell curve calibration to normalized ratings
router.post('/hr/calibrate', authMiddleware, requireRole(['hr_admin', 'hrbp', 'system_admin']), async (req, res) => {
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
    
    console.log(`Starting calibration for quarter ${quarterNum}, cycle ${cycle_id}`);
    try {
      const result = await applyCalibration(quarterNum, cycle_id, userId);
      console.log(`Calibration completed:`, result);
      res.json({ data: result });
    } catch (error) {
      console.error('Calibration error:', error);
      res.status(500).json({ 
        error: error.message,
        details: 'Check server console logs for more information about why calibration failed.'
      });
    }
  } catch (error) {
    console.error('Calibrate ratings error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/evaluations/hr/normalized-ratings
// Get normalized ratings for HR review
router.get('/hr/normalized-ratings', authMiddleware, requireRole(['hr_admin', 'hrbp', 'system_admin']), async (req, res) => {
  try {
    const { quarter, cycle_id, status } = req.query;
    
    if (!quarter || !cycle_id) {
      return res.status(400).json({ error: 'quarter and cycle_id are required' });
    }
    
    let sql = `
      SELECT 
        nr.*,
        e.full_name as employee_name,
        e.emp_code as employee_code,
        e.grade,
        m.full_name as manager_name,
        m.emp_code as manager_code
      FROM normalized_ratings nr
      JOIN employees e ON e.id = nr.employee_id
      LEFT JOIN employees m ON m.id = nr.manager_id
      WHERE nr.performance_cycle_id = $1 AND nr.quarter = $2
    `;
    const params = [cycle_id, parseInt(quarter)];
    let idx = 3;
    
    if (status) {
      sql += ` AND nr.status = $${idx++}`;
      params.push(status);
    }
    
    sql += ' ORDER BY e.emp_code';
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching normalized ratings:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/evaluations/hr/send-to-manager
// Send normalized and calibrated ratings to manager for review
// Note: Calibration must be applied before sending to manager
router.post('/hr/send-to-manager', authMiddleware, requireRole(['hr_admin', 'hrbp', 'system_admin']), async (req, res) => {
  try {
    const { employeeIds, quarter, cycleId } = req.body;
    
    if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({ error: 'employeeIds array is required' });
    }
    if (!quarter || !cycleId) {
      return res.status(400).json({ error: 'quarter and cycleId are required' });
    }
    
    // Verify that calibrated_rating exists for all employees before sending
    // Use IN clause with proper array handling for Sequelize
    const placeholders = employeeIds.map((_, i) => `?`).join(',');
    const checkQuery = `
      SELECT employee_id, calibrated_rating
      FROM normalized_ratings
      WHERE employee_id IN (${placeholders})
        AND quarter = ?
        AND performance_cycle_id = ?
        AND status IN ('DRAFT', 'REJECTED')
    `;
    const checkResult = await query(checkQuery, [...employeeIds, parseInt(quarter), cycleId]);
    
    const missingCalibration = checkResult.rows.filter(r => r.calibrated_rating === null || r.calibrated_rating === undefined);
    if (missingCalibration.length > 0) {
      return res.status(400).json({ 
        error: 'Calibration required before sending to manager',
        details: `${missingCalibration.length} employees do not have calibrated_rating. Please run calibration first.`
      });
    }
    
    // Use IN clause with proper array handling for Sequelize
    const updatePlaceholders = employeeIds.map((_, i) => `?`).join(',');
    const result = await query(
      `UPDATE normalized_ratings 
       SET status = 'SENT_TO_MANAGER', updated_at = NOW()
       WHERE employee_id IN (${updatePlaceholders}) 
         AND quarter = ? 
         AND performance_cycle_id = ?
         AND status IN ('DRAFT', 'REJECTED')
         AND calibrated_rating IS NOT NULL`,
      [...employeeIds, parseInt(quarter), cycleId]
    );
    
    res.json({ data: [], count: result.rowCount });
  } catch (error) {
    console.error('Error sending to manager:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/evaluations/manager/review
// Manager accepts or rejects normalized ratings
router.post('/manager/review', authMiddleware, async (req, res) => {
  try {
    const { employeeId, quarter, cycleId, action } = req.body;
    
    if (!employeeId || !quarter || !cycleId || !action) {
      return res.status(400).json({ error: 'employeeId, quarter, cycleId, and action are required' });
    }
    if (!['ACCEPT', 'REJECT'].includes(action)) {
      return res.status(400).json({ error: 'action must be ACCEPT or REJECT' });
    }
    
    const newStatus = action === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';
    
    const result = await query(
      `UPDATE normalized_ratings 
       SET status = $1, updated_at = NOW()
       WHERE employee_id = $2 
         AND quarter = $3 
         AND performance_cycle_id = $4
         AND status = 'SENT_TO_MANAGER'`,
      [newStatus, employeeId, parseInt(quarter), cycleId]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'No rating found or already processed' });
    }
    
    res.json({ data: { employeeId, status: newStatus } });
  } catch (error) {
    console.error('Error in manager review:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/evaluations/hr/publish
// Publish accepted normalized and calibrated ratings
// Once published, records become immutable
router.post('/hr/publish', authMiddleware, requireRole(['hr_admin', 'hrbp', 'system_admin']), async (req, res) => {
  try {
    const { employeeIds, quarter, cycleId } = req.body;
    
    if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({ error: 'employeeIds array is required' });
    }
    if (!quarter || !cycleId) {
      return res.status(400).json({ error: 'quarter and cycleId are required' });
    }
    
    // Verify all have calibrated_rating before publishing
    // Use IN clause with proper array handling for Sequelize
    const checkPlaceholders = employeeIds.map((_, i) => `?`).join(',');
    const checkQuery = await query(
      `SELECT employee_id, calibrated_rating, status
       FROM normalized_ratings
       WHERE employee_id IN (${checkPlaceholders})
         AND quarter = ?
         AND performance_cycle_id = ?`,
      [...employeeIds, parseInt(quarter), cycleId]
    );
    
    const missingCalibration = checkQuery.rows.filter(r => 
      r.status === 'ACCEPTED' && (r.calibrated_rating === null || r.calibrated_rating === undefined)
    );
    
    if (missingCalibration.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot publish without calibrated_rating',
        details: `${missingCalibration.length} employees do not have calibrated_rating. Please run calibration first.`
      });
    }
    
    // Get HR user ID (profile_id) from authenticated user
    const hrUserId = req.user?.userId;
    if (!hrUserId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Use IN clause with proper array handling for Sequelize
    const publishPlaceholders = employeeIds.map((_, i) => `?`).join(',');
    
    // Update normalized_ratings to PUBLISHED
    const result = await query(
      `UPDATE normalized_ratings 
       SET status = 'PUBLISHED', updated_at = NOW()
       WHERE employee_id IN (${publishPlaceholders}) 
         AND quarter = ? 
         AND performance_cycle_id = ?
         AND status = 'ACCEPTED'
         AND calibrated_rating IS NOT NULL`,
      [...employeeIds, parseInt(quarter), cycleId]
    );

    // Also update quarterly_manager_reviews with HR approval and release timestamps
    // This allows employees to accept/reject ratings
    const qmrUpdatePlaceholders = employeeIds.map((_, i) => `?`).join(',');
    await query(
      `UPDATE quarterly_manager_reviews 
       SET hr_approved_at = NOW(),
           hr_approved_by = ?,
           released_at = NOW(),
           updated_at = NOW()
       WHERE employee_id IN (${qmrUpdatePlaceholders})
         AND quarter = ?
         AND cycle_id = ?
         AND hr_approved_at IS NULL`,
      [hrUserId, ...employeeIds, parseInt(quarter), cycleId]
    );
    
    res.json({ data: [], count: result.rowCount });
  } catch (error) {
    console.error('Error publishing ratings:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/evaluations/hr/normalized-rating/:id
// Update normalized rating (for rejected ratings)
// When updated, calibrated_rating is cleared and status reset to DRAFT (recalibration needed)
router.put('/hr/normalized-rating/:id', authMiddleware, requireRole(['hr_admin', 'hrbp', 'system_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { final_normalized_rating } = req.body;
    
    if (final_normalized_rating === undefined || final_normalized_rating === null) {
      return res.status(400).json({ error: 'final_normalized_rating is required' });
    }
    
    // Check if record is PUBLISHED (immutable)
    const checkQuery = await query(
      `SELECT status FROM normalized_ratings WHERE id = $1`,
      [id]
    );
    
    if (checkQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Rating not found' });
    }
    
    if (checkQuery.rows[0].status === 'PUBLISHED') {
      return res.status(403).json({ error: 'Cannot update PUBLISHED ratings. They are immutable.' });
    }
    
    const result = await query(
      `UPDATE normalized_ratings 
       SET final_normalized_rating = $1, 
           calibrated_rating = NULL,
           status = 'DRAFT',
           updated_at = NOW()
       WHERE id = $2 
         AND status IN ('REJECTED', 'DRAFT', 'SENT_TO_MANAGER')
         AND status != 'PUBLISHED'`,
      [parseFloat(final_normalized_rating), id]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Rating not found or cannot be updated' });
    }
    
    res.json({ 
      data: { 
        id, 
        final_normalized_rating,
        message: 'Rating updated. Calibration cleared. Please run calibration again before sending to manager.'
      } 
    });
  } catch (error) {
    console.error('Error updating normalized rating:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/evaluations/manager/normalized-ratings
// Get normalized and calibrated ratings for a manager's team
// Managers see: raw_rating, final_normalized_rating, calibrated_rating
router.get('/manager/normalized-ratings', authMiddleware, async (req, res) => {
  try {
    const { manager_id, quarter, cycle_id } = req.query;
    
    if (!manager_id || !quarter || !cycle_id) {
      return res.status(400).json({ error: 'manager_id, quarter, and cycle_id are required' });
    }
    
    // Get manager's emp_code
    const managerResult = await query(
      `SELECT emp_code FROM employees WHERE id = ?`,
      [manager_id]
    );
    
    if (managerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Manager not found' });
    }
    
    const managerEmpCode = managerResult.rows[0].emp_code;
    
    const result = await query(
      `SELECT 
        nr.id,
        nr.employee_id,
        nr.raw_rating,
        nr.final_normalized_rating,
        nr.calibrated_rating,
        nr.status,
        e.full_name as employee_name,
        e.emp_code as employee_code,
        e.grade
      FROM normalized_ratings nr
      JOIN employees e ON e.id = nr.employee_id
      WHERE nr.performance_cycle_id = ? 
        AND nr.quarter = ?
        AND e.manager_code = ?
        AND nr.status = 'SENT_TO_MANAGER'
      ORDER BY e.emp_code`,
      [cycle_id, parseInt(quarter), managerEmpCode]
    );
    
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching manager normalized ratings:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/evaluations/employee/normalized-rating
// Get published calibrated rating for an employee (for My Rating page)
// Employees see only calibrated_rating after HR publishes
router.get('/employee/normalized-rating', authMiddleware, async (req, res) => {
  try {
    const { employee_id, quarter, cycle_id } = req.query;
    
    if (!employee_id || !quarter || !cycle_id) {
      return res.status(400).json({ error: 'employee_id, quarter, and cycle_id are required' });
    }
    
    const userEmployee = await query(
      `SELECT id FROM employees WHERE id = $1`,
      [employee_id]
    );
    
    if (userEmployee.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    const currentEmployeeId = userEmployee.rows[0].id;
    
    // Only allow employees to see their own ratings
    if (currentEmployeeId !== employee_id) {
      return res.status(403).json({ error: 'Access denied. You can only view your own ratings.' });
    }
    
    const result = await query(
      `SELECT 
        calibrated_rating,
        status
      FROM normalized_ratings
      WHERE employee_id = $1 
        AND performance_cycle_id = $2 
        AND quarter = $3
        AND status = 'PUBLISHED'
      LIMIT 1`,
      [employee_id, cycle_id, parseInt(quarter)]
    );
    
    if (result.rows.length === 0) {
      return res.json({ data: null });
    }
    
    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching employee normalized rating:', error);
    res.status(500).json({ error: error.message });
  }
});

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

router.get('/year-end-evaluation', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id } = req.query;
    
    if (!employee_id || !cycle_id) {
      return res.status(400).json({ error: 'employee_id and cycle_id are required' });
    }
    
    // Get year-end evaluation from manager_evaluations
    const result = await query(
      `SELECT * FROM manager_evaluations 
       WHERE employee_id = ? AND cycle_id = ?`,
      [employee_id, cycle_id]
    );
    
    if (result.rows.length === 0) {
      return res.json({ data: null });
    }
    
    const yearEndData = result.rows[0];
    
    // Fetch calibrated ratings from normalized_ratings for each quarter
    // Use calibrated_rating if available (PUBLISHED), otherwise use q1-q4_rating from manager_evaluations
    const calibratedRatingsQuery = await query(
      `SELECT quarter, calibrated_rating 
       FROM normalized_ratings 
       WHERE employee_id = ? 
         AND performance_cycle_id = ? 
         AND quarter IN (1, 2, 3, 4)
         AND status = 'PUBLISHED'
         AND calibrated_rating IS NOT NULL
       ORDER BY quarter`,
      [employee_id, cycle_id]
    );
    
    // Override q1-q4_rating with calibrated_rating if available
    const calibratedRatings = {};
    calibratedRatingsQuery.rows.forEach(row => {
      calibratedRatings[`q${row.quarter}_rating`] = row.calibrated_rating;
    });
    
    // Update yearEndData with calibrated ratings
    if (calibratedRatings.q1_rating !== undefined) {
      yearEndData.q1_rating = calibratedRatings.q1_rating;
    }
    if (calibratedRatings.q2_rating !== undefined) {
      yearEndData.q2_rating = calibratedRatings.q2_rating;
    }
    if (calibratedRatings.q3_rating !== undefined) {
      yearEndData.q3_rating = calibratedRatings.q3_rating;
    }
    if (calibratedRatings.q4_rating !== undefined) {
      yearEndData.q4_rating = calibratedRatings.q4_rating;
    }
    
    // Recalculate overall rating if any quarterly ratings were updated
    if (Object.keys(calibratedRatings).length > 0) {
      const ratingsArray = [
        yearEndData.q1_rating,
        yearEndData.q2_rating,
        yearEndData.q3_rating,
        yearEndData.q4_rating
      ].filter(r => r !== null && r !== undefined);
      
      if (ratingsArray.length > 0) {
        yearEndData.calculated_overall_rating = ratingsArray.reduce((a, b) => parseFloat(a) + parseFloat(b), 0) / ratingsArray.length;
      }
    }
    
    res.json({ data: yearEndData });
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
// When approved, quarterly ratings (q1-q4) are set to calibrated_rating from normalized_ratings
router.post('/hr-approve-year-end-review', authMiddleware, async (req, res) => {
  try {
    const { manager_evaluation_id } = req.body;

    if (!manager_evaluation_id) {
      return res.status(400).json({ error: 'manager_evaluation_id is required' });
    }

    // First, get the employee_id and cycle_id from manager_evaluations
    const evalResult = await query(
      `SELECT employee_id, cycle_id FROM manager_evaluations 
       WHERE id = ? AND status = 'submitted' AND released_at IS NULL`,
      [manager_evaluation_id]
    );

    if (evalResult.rows.length === 0) {
      return res.status(404).json({ error: 'Evaluation not found or already approved' });
    }

    const { employee_id, cycle_id } = evalResult.rows[0];

    // Fetch calibrated_rating from normalized_ratings for each quarter (1-4)
    const calibratedRatingsQuery = await query(
      `SELECT quarter, calibrated_rating 
       FROM normalized_ratings 
       WHERE employee_id = ? 
         AND performance_cycle_id = ? 
         AND quarter IN (1, 2, 3, 4)
         AND status = 'PUBLISHED'
         AND calibrated_rating IS NOT NULL
       ORDER BY quarter`,
      [employee_id, cycle_id]
    );

    // Build update query with calibrated ratings
    const calibratedRatings = {};
    calibratedRatingsQuery.rows.forEach(row => {
      calibratedRatings[`q${row.quarter}_rating`] = row.calibrated_rating;
    });

    // Get current quarterly ratings before update
    const currentRatingsResult = await query(
      `SELECT q1_rating, q2_rating, q3_rating, q4_rating 
       FROM manager_evaluations 
       WHERE id = ?`,
      [manager_evaluation_id]
    );

    // Merge current ratings with calibrated ratings (calibrated takes precedence)
    const finalQuarterlyRatings = {
      q1: currentRatingsResult.rows[0]?.q1_rating ?? null,
      q2: currentRatingsResult.rows[0]?.q2_rating ?? null,
      q3: currentRatingsResult.rows[0]?.q3_rating ?? null,
      q4: currentRatingsResult.rows[0]?.q4_rating ?? null,
    };

    // Override with calibrated ratings where available
    Object.keys(calibratedRatings).forEach(key => {
      const quarterNum = parseInt(key.replace('q', '').replace('_rating', ''));
      finalQuarterlyRatings[`q${quarterNum}`] = calibratedRatings[key];
    });

    // Prepare SET clause for quarters that have calibrated ratings
    const setClauses = ['released_at = NOW()', 'updated_at = NOW()'];
    const updateParams = [];

    // Add quarter rating updates if calibrated ratings exist
    for (let q = 1; q <= 4; q++) {
      const quarterKey = `q${q}_rating`;
      if (calibratedRatings[quarterKey] !== undefined) {
        setClauses.push(`${quarterKey} = ?`);
        updateParams.push(calibratedRatings[quarterKey]);
      }
    }

    // Calculate average of all non-null quarterly ratings (after applying calibrated ratings)
    const ratingsArray = [
      finalQuarterlyRatings.q1,
      finalQuarterlyRatings.q2,
      finalQuarterlyRatings.q3,
      finalQuarterlyRatings.q4
    ].filter(r => r !== null && r !== undefined);

    if (ratingsArray.length > 0) {
      const avgRating = ratingsArray.reduce((a, b) => parseFloat(a) + parseFloat(b), 0) / ratingsArray.length;
      setClauses.push('calculated_overall_rating = ?');
      updateParams.push(parseFloat(avgRating.toFixed(2)));
    }

    // Add manager_evaluation_id as the last parameter
    updateParams.push(manager_evaluation_id);

    // Update manager_evaluations with calibrated ratings and release
    const updateQuery = `
      UPDATE manager_evaluations 
      SET ${setClauses.join(', ')}
      WHERE id = ?
      RETURNING *
    `;

    const result = await query(updateQuery, updateParams);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Failed to update evaluation' });
    }

    // Log which quarters were updated
    const updatedQuarters = Object.keys(calibratedRatings).map(k => k.replace('_rating', '').toUpperCase());
    console.log(`Year-end approval: Updated quarterly ratings for employee ${employee_id} - Quarters: ${updatedQuarters.join(', ')}`);

    res.json({ 
      data: result.rows[0],
      message: `Year-end evaluation approved. Quarterly ratings updated from calibrated ratings: ${updatedQuarters.join(', ')}`
    });
  } catch (error) {
    console.error('HR approve year-end review error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

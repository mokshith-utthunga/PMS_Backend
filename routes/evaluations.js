import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { normalizeRatings } from '../services/normalizationService.js';
import { applyCalibration, isCalibrationEnabled } from '../services/calibrationService.js';
import { checkManagerOrDelegate } from './delegations.js';
import { canPerformTransitionActions, getManagerRoleForTransition } from '../services/transitionService.js';

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
    const { employee_id, cycle_id, quarter, overall_rating, overall_comments, status, period_type, transition_id, period_start_date, period_end_date } = req.body;
    
    // Validate and parse quarter to integer
    if (!quarter) {
      return res.status(400).json({ error: 'quarter is required' });
    }
    const quarterNum = parseInt(quarter);
    if (isNaN(quarterNum) || quarterNum < 1 || quarterNum > 4) {
      return res.status(400).json({ error: 'quarter must be a number between 1 and 4' });
    }
    
    // Auto-detect transition if not explicitly provided
    let periodType = period_type || 'full_quarter';
    let transitionId = transition_id || null;
    let periodStartDate = period_start_date || null;
    let periodEndDate = period_end_date || null;
    
    // If transition exists but period_type not provided, determine it based on current date
    if (employee_id && cycle_id && !period_type && !transition_id) {
      const transitionResult = await query(
        `SELECT id, transition_date
         FROM employee_quarter_transitions 
         WHERE employee_id = $1 AND cycle_id = $2 AND quarter = $3`,
        [employee_id, cycle_id, quarterNum]
      );

      if (transitionResult.rows.length > 0) {
        const transition = transitionResult.rows[0];
        transitionId = transition.id;
        const transitionDate = new Date(transition.transition_date);
        const now = new Date();
        transitionDate.setHours(0, 0, 0, 0);
        
        // Get quarter date range from quarterly_cycles table
        const quarterRange = await query(
          `SELECT quarter_start_date, quarter_end_date 
           FROM quarterly_cycles 
           WHERE performance_cycle_id = $1 AND quarter = $2`,
          [cycle_id, quarterNum]
        );
        
        if (quarterRange.rows.length > 0) {
          const quarterStart = new Date(quarterRange.rows[0].quarter_start_date);
          const quarterEnd = new Date(quarterRange.rows[0].quarter_end_date);
          
          if (now >= transitionDate) {
            // Review is being created after transition, mark as post_transition
            periodType = 'post_transition';
            // Format transition date directly to avoid timezone issues
            // transition.transition_date is already a date string from DB, use it directly
            periodStartDate = transition.transition_date instanceof Date 
              ? transition.transition_date.toISOString().split('T')[0]
              : (typeof transition.transition_date === 'string' 
                ? transition.transition_date.split('T')[0] 
                : transitionDate.toISOString().split('T')[0]);
            periodEndDate = quarterEnd.toISOString().split('T')[0];
          } else {
            // Review is being created before transition, mark as pre_transition
            periodType = 'pre_transition';
            periodStartDate = quarterStart.toISOString().split('T')[0];
            // For pre-transition end date, use the transition date itself (not transition date - 1)
            // Format transition date directly to avoid timezone issues
            periodEndDate = transition.transition_date instanceof Date
              ? transition.transition_date.toISOString().split('T')[0]
              : (typeof transition.transition_date === 'string'
                ? transition.transition_date.split('T')[0]
                : transitionDate.toISOString().split('T')[0]);
          }
        }
      }
    }
    
    // Use the unique constraint that includes period_type and transition_id
    // The constraint is: (employee_id, cycle_id, quarter, period_type, COALESCE(transition_id, '00000000-0000-0000-0000-000000000000'::uuid))
    const result = await query(
      `INSERT INTO quarterly_self_reviews (
        id, employee_id, cycle_id, quarter, overall_rating, overall_comments, status, 
        period_type, transition_id, period_start_date, period_end_date,
        submitted_at, created_at, updated_at
      )
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::period_type, $8, $9, $10, $11, NOW(), NOW())
       ON CONFLICT (employee_id, cycle_id, quarter, period_type, (COALESCE(transition_id, '00000000-0000-0000-0000-000000000000'::uuid))) DO UPDATE SET
         overall_rating = EXCLUDED.overall_rating,
         overall_comments = EXCLUDED.overall_comments,
         status = EXCLUDED.status,
         period_start_date = COALESCE(EXCLUDED.period_start_date, quarterly_self_reviews.period_start_date),
         period_end_date = COALESCE(EXCLUDED.period_end_date, quarterly_self_reviews.period_end_date),
         submitted_at = CASE WHEN EXCLUDED.status = 'submitted' THEN NOW() ELSE quarterly_self_reviews.submitted_at END,
         updated_at = NOW()
       RETURNING *`,
      [
        employee_id ?? null,
        cycle_id ?? null,
        quarterNum, // Use parsed integer, not raw quarter
        overall_rating ?? null,
        overall_comments ?? null,
        status || 'pending',
        periodType,
        transitionId,
        periodStartDate,
        periodEndDate,
        status === 'submitted' ? new Date() : null
      ]
    );
    // Return response with transition info for frontend date validation bypass
    const responseData = result.rows[0];
    if (transitionId) {
      // Check if we're within quarter dates (required constraint for transition actions)
      const canPerform = await canPerformTransitionActions(employee_id, cycle_id, quarterNum);
      if (canPerform) {
        responseData.has_active_transition = true;
        responseData.date_validation_bypassed = true; // Frontend can use this to bypass date checks
      } else {
        // Transition exists but we're outside quarter dates - don't allow
        return res.status(400).json({ 
          error: 'Actions for employees with transitions are only allowed within the current quarter dates' 
        });
      }
    }
    
    res.json({ data: responseData });
  } catch (error) {
    console.error('Error creating/updating quarterly self review:', error);
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
    const { employee_id, cycle_id, quarter, period_type, transition_id } = req.query;
    
    // Get current user's employee ID (for manager role check)
    let managerId = null;
    if (employee_id && cycle_id && quarter) {
      // Only check manager role if viewing another employee's data
      const empResult = await query(
        'SELECT id FROM employees WHERE profile_id = $1',
        [req.user.userId]
      );
      if (empResult.rows.length > 0) {
        managerId = empResult.rows[0].id;
      }
    }
    
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

    // Apply manager role filtering ONLY if period_type and transition_id are NOT specified
    // If period_type/transition_id are specified, we want to fetch that specific review regardless of manager role
    // This allows checking submission status for both pre and post-transition reviews
    if (!period_type && !transition_id && managerId && employee_id && cycle_id && quarter && employee_id !== managerId) {
      const managerRole = await getManagerRoleForTransition(managerId, employee_id, cycle_id, parseInt(quarter));
      
      if (managerRole === 'old_manager') {
        // Old manager: only pre-transition reviews
        sql += ` AND (period_type IS NULL OR period_type = 'full_quarter'::period_type OR period_type = 'pre_transition'::period_type)`;
      } else if (managerRole === 'new_manager') {
        // New manager: only post-transition reviews
        sql += ` AND (period_type IS NULL OR period_type = 'full_quarter'::period_type OR period_type = 'post_transition'::period_type)`;
      } else if (managerRole === 'same_manager') {
        // Same manager: both pre and post-transition (no additional filter needed)
      }
      // If managerRole is null, user is not involved in transition, show all data
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
    const { employee_id, cycle_id, quarter, reviewer_id, overall_comments, guidance, status, calculated_overall_rating, period_type, transition_id, period_start_date, period_end_date } = req.body;
    
    // Validate and parse quarter to integer
    if (!quarter) {
      return res.status(400).json({ error: 'quarter is required' });
    }
    const quarterNum = parseInt(quarter);
    if (isNaN(quarterNum) || quarterNum < 1 || quarterNum > 4) {
      return res.status(400).json({ error: 'quarter must be a number between 1 and 4' });
    }
    
    // Check if review is already submitted for this period (prevent resubmission)
    if (status === 'submitted' && employee_id && cycle_id) {
      let existingReviewQuery = `
        SELECT id, status, period_type, transition_id
        FROM quarterly_manager_reviews
        WHERE employee_id = $1 
          AND cycle_id = $2 
          AND quarter = $3
      `;
      const existingParams = [employee_id, cycle_id, quarterNum];
      let paramIdx = 4;
      
      // For transition employees, check specific period
      if (period_type && transition_id) {
        existingReviewQuery += ` AND period_type = $${paramIdx}::period_type AND transition_id = $${paramIdx + 1}`;
        existingParams.push(period_type, transition_id);
      } else if (period_type) {
        existingReviewQuery += ` AND period_type = $${paramIdx}::period_type`;
        existingParams.push(period_type);
      } else {
        existingReviewQuery += ` AND (period_type IS NULL OR period_type = 'full_quarter'::period_type)`;
      }
      
      existingReviewQuery += ` AND status = 'submitted' LIMIT 1`;
      
      const existingReview = await query(existingReviewQuery, existingParams);
      
      if (existingReview.rows.length > 0) {
        return res.status(400).json({ 
          error: 'Review already submitted for this period',
          message: 'This review has already been submitted. Please contact HR if you need to make changes.',
          review_id: existingReview.rows[0].id
        });
      }
    }
    
    // Auto-detect transition if not explicitly provided
    let periodType = period_type || 'full_quarter';
    let transitionId = transition_id || null;
    let periodStartDate = period_start_date || null;
    let periodEndDate = period_end_date || null;
    
    // If transition exists but period_type not provided, determine it based on current date
    if (employee_id && cycle_id && !period_type && !transition_id) {
      const transitionResult = await query(
        `SELECT id, transition_date, old_manager_id, new_manager_id
         FROM employee_quarter_transitions 
         WHERE employee_id = $1 AND cycle_id = $2 AND quarter = $3`,
        [employee_id, cycle_id, quarterNum]
      );

      if (transitionResult.rows.length > 0) {
        const transition = transitionResult.rows[0];
        transitionId = transition.id;
        const transitionDate = new Date(transition.transition_date);
        const now = new Date();
        transitionDate.setHours(0, 0, 0, 0);
        
        // Get quarter date range from quarterly_cycles table
        const quarterRange = await query(
          `SELECT quarter_start_date, quarter_end_date 
           FROM quarterly_cycles 
           WHERE performance_cycle_id = $1 AND quarter = $2`,
          [cycle_id, quarter]
        );
        
        if (quarterRange.rows.length > 0) {
          const quarterStart = new Date(quarterRange.rows[0].quarter_start_date);
          const quarterEnd = new Date(quarterRange.rows[0].quarter_end_date);
          
          // Determine period based on reviewer - old manager reviews pre, new manager reviews post
          if (reviewer_id && transition.old_manager_id && reviewer_id === transition.old_manager_id) {
            periodType = 'pre_transition';
            periodStartDate = quarterStart.toISOString().split('T')[0];
            // For pre-transition end date, use the transition date itself (not transition date - 1)
            // Format transition date directly to avoid timezone issues
            periodEndDate = transition.transition_date instanceof Date
              ? transition.transition_date.toISOString().split('T')[0]
              : (typeof transition.transition_date === 'string'
                ? transition.transition_date.split('T')[0]
                : transitionDate.toISOString().split('T')[0]);
          } else if (reviewer_id && transition.new_manager_id && reviewer_id === transition.new_manager_id) {
            periodType = 'post_transition';
            // Format transition date directly to avoid timezone issues
            periodStartDate = transition.transition_date instanceof Date 
              ? transition.transition_date.toISOString().split('T')[0]
              : (typeof transition.transition_date === 'string' 
                ? transition.transition_date.split('T')[0] 
                : transitionDate.toISOString().split('T')[0]);
            periodEndDate = quarterEnd.toISOString().split('T')[0];
          } else if (now >= transitionDate) {
            // Default: if after transition date, assume post-transition
            periodType = 'post_transition';
            // Format transition date directly to avoid timezone issues
            periodStartDate = transition.transition_date instanceof Date 
              ? transition.transition_date.toISOString().split('T')[0]
              : (typeof transition.transition_date === 'string' 
                ? transition.transition_date.split('T')[0] 
                : transitionDate.toISOString().split('T')[0]);
            periodEndDate = quarterEnd.toISOString().split('T')[0];
          } else {
            // Default: if before transition date, assume pre-transition
            periodType = 'pre_transition';
            periodStartDate = quarterStart.toISOString().split('T')[0];
            // For pre-transition end date, use the transition date itself (not transition date - 1)
            // Format transition date directly to avoid timezone issues
            periodEndDate = transition.transition_date instanceof Date
              ? transition.transition_date.toISOString().split('T')[0]
              : (typeof transition.transition_date === 'string'
                ? transition.transition_date.split('T')[0]
                : transitionDate.toISOString().split('T')[0]);
          }
        }
      }
    }
    
    // Check if user is manager or delegate
    if (employee_id && cycle_id) {
      const auth = await checkManagerOrDelegate(
        req.user.userId,
        employee_id,
        cycle_id,
        quarterNum
      );
      
      if (!auth.isAuthorized) {
        return res.status(403).json({ error: 'Not authorized to submit review for this employee' });
      }
    }
    
    // Special handling for transition employees: Aggregation logic
    // When New Manager submits post-transition review, aggregate with pre-transition rating
    let finalCalculatedRating = calculated_overall_rating;
    if (periodType === 'post_transition' && status === 'submitted' && transitionId && calculated_overall_rating) {
      // Get pre-transition manager review rating
      const preTransitionReview = await query(
        `SELECT calculated_overall_rating 
         FROM quarterly_manager_reviews 
         WHERE employee_id = $1 
           AND cycle_id = $2 
           AND quarter = $3 
           AND period_type = 'pre_transition'::period_type
           AND transition_id = $4
           AND status = 'submitted'
         ORDER BY updated_at DESC
         LIMIT 1`,
        [employee_id, cycle_id, quarterNum, transitionId]
      );

      if (preTransitionReview.rows.length > 0 && preTransitionReview.rows[0].calculated_overall_rating) {
        const preRating = parseFloat(preTransitionReview.rows[0].calculated_overall_rating);
        const postRating = parseFloat(calculated_overall_rating);
        
        // Aggregate: overall_rating = (old_manager_overall_rating + new_manager_overall_rating) / 2
        finalCalculatedRating = ((preRating + postRating) / 2).toFixed(2);
        
        console.log(`[Transition Aggregation] Employee ${employee_id}, Quarter ${quarterNum}: Pre=${preRating}, Post=${postRating}, Aggregated=${finalCalculatedRating}`);
      }
    }

    // Upsert quarterly manager review
    // Use the unique constraint that includes period_type and transition_id
    // The constraint is: (employee_id, cycle_id, quarter, period_type, COALESCE(transition_id, '00000000-0000-0000-0000-000000000000'::uuid))
    const result = await query(
      `INSERT INTO quarterly_manager_reviews (
        id, employee_id, cycle_id, quarter, reviewer_id, overall_comments, guidance, 
        calculated_overall_rating, status, period_type, transition_id, period_start_date, period_end_date,
        approved_at, created_at, updated_at
      )
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9::period_type, $10, $11, $12, $13, NOW(), NOW())
       ON CONFLICT (employee_id, cycle_id, quarter, period_type, (COALESCE(transition_id, '00000000-0000-0000-0000-000000000000'::uuid))) DO UPDATE SET
         overall_comments = EXCLUDED.overall_comments,
         guidance = EXCLUDED.guidance,
         calculated_overall_rating = EXCLUDED.calculated_overall_rating,
         status = EXCLUDED.status,
         period_start_date = COALESCE(EXCLUDED.period_start_date, quarterly_manager_reviews.period_start_date),
         period_end_date = COALESCE(EXCLUDED.period_end_date, quarterly_manager_reviews.period_end_date),
         approved_at = CASE WHEN EXCLUDED.status = 'submitted' THEN NOW() ELSE quarterly_manager_reviews.approved_at END,
         updated_at = NOW()
       RETURNING *`,
      [
        employee_id ?? null,
        cycle_id ?? null,
        quarterNum, // Use parsed integer, not raw quarter
        reviewer_id ?? null,
        overall_comments ?? null,
        guidance ?? null,
        finalCalculatedRating ?? null,
        status || 'pending',
        periodType,
        transitionId,
        periodStartDate,
        periodEndDate,
        status === 'submitted' ? new Date() : null
      ]
    );

    // Also upsert into manager_evaluations table with quarterly rating
    if (employee_id && cycle_id && reviewer_id) {
      // Use aggregated rating if it was calculated
      const quarterRating = finalCalculatedRating ?? calculated_overall_rating ?? null;
      
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

    // Return response with transition info for frontend date validation bypass
    const responseData = result.rows[0];
    if (transitionId) {
      // Check if we're within quarter dates (required constraint for transition actions)
      const canPerform = await canPerformTransitionActions(employee_id, cycle_id, quarterNum);
      if (canPerform) {
        responseData.has_active_transition = true;
        responseData.date_validation_bypassed = true; // Frontend can use this to bypass date checks
      } else {
        // Transition exists but we're outside quarter dates - don't allow
        return res.status(400).json({ 
          error: 'Actions for employees with transitions are only allowed within the current quarter dates' 
        });
      }
    }
    
    res.json({ data: responseData });
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
    
    // Check if calibration is enabled - only require calibrated_rating if enabled
    const calibrationEnabled = await isCalibrationEnabled();
    
    // Verify that calibrated_rating exists for all employees before sending (only if calibration is enabled)
    if (calibrationEnabled) {
      // Use IN clause with proper array handling for Sequelize
      const checkPlaceholders = employeeIds.map((_, i) => `?`).join(',');
      const checkResult = await query(
        `SELECT employee_id, calibrated_rating
         FROM normalized_ratings
         WHERE employee_id IN (${checkPlaceholders})
           AND quarter = ?
           AND performance_cycle_id = ?
           AND status IN ('DRAFT', 'REJECTED')`,
        [...employeeIds, parseInt(quarter), cycleId]
      );
      
      const missingCalibration = checkResult.rows.filter(r => r.calibrated_rating === null || r.calibrated_rating === undefined);
      if (missingCalibration.length > 0) {
        return res.status(400).json({ 
          error: 'Calibration required before sending to manager',
          details: `${missingCalibration.length} employees do not have calibrated_rating. Please run calibration first.`,
          uncalibrated: missingCalibration.map(r => r.employee_id)
        });
      }
    }
    
    // Update status to SENT_TO_MANAGER
    // Use IN clause with proper array handling for Sequelize
    const updatePlaceholders = employeeIds.map((_, i) => `?`).join(',');
    // Only require calibrated_rating in WHERE clause if calibration is enabled
    const whereClause = calibrationEnabled 
      ? `AND status IN ('DRAFT', 'REJECTED') AND calibrated_rating IS NOT NULL`
      : `AND status IN ('DRAFT', 'REJECTED')`;
    
    const result = await query(
      `UPDATE normalized_ratings 
       SET status = 'SENT_TO_MANAGER', updated_at = NOW()
       WHERE employee_id IN (${updatePlaceholders})
         AND quarter = ?
         AND performance_cycle_id = ?
         ${whereClause}`,
      [...employeeIds, parseInt(quarter), cycleId]
    );
    
    console.log(`[Send to Manager] Sent ${result.rowCount} ratings to managers (excluding pre-transition reviews)`);
    
    res.json({ data: [], count: result.rowCount });
  } catch (error) {
    console.error('Error sending to manager:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/evaluations/manager/review
// Manager accepts or rejects normalized ratings
// For transition employees: Must filter by period_type and transition_id
router.post('/manager/review', authMiddleware, async (req, res) => {
  try {
    const { employeeId, quarter, cycleId, action, periodType, transitionId } = req.body;
    
    if (!employeeId || !quarter || !cycleId || !action) {
      return res.status(400).json({ error: 'employeeId, quarter, cycleId, and action are required' });
    }
    if (!['ACCEPT', 'REJECT'].includes(action)) {
      return res.status(400).json({ error: 'action must be ACCEPT or REJECT' });
    }
    
    const newStatus = action === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';
    
    // Update normalized_ratings status
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
      return res.status(404).json({ 
        error: 'No rating found or already processed',
        hint: 'Make sure the rating status is SENT_TO_MANAGER'
      });
    }
    
    console.log(`[Manager Review] Employee ${employeeId}, Quarter ${quarter}: ${action}ED`);
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
    
    // Check if calibration is enabled - only require calibrated_rating if enabled
    const calibrationEnabled = await isCalibrationEnabled();
    
    // Verify all have calibrated_rating before publishing (only if calibration is enabled)
    if (calibrationEnabled) {
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
    }
    
    // Get HR user ID (profile_id) from authenticated user
    const hrUserId = req.user?.userId;
    if (!hrUserId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Use IN clause with proper array handling for Sequelize
    const publishPlaceholders = employeeIds.map((_, i) => `?`).join(',');
    
    // Update normalized_ratings to PUBLISHED
    // Only require calibrated_rating in WHERE clause if calibration is enabled
    const whereClause = calibrationEnabled
      ? `AND status = 'ACCEPTED' AND calibrated_rating IS NOT NULL`
      : `AND status = 'ACCEPTED'`;
    
    const result = await query(
      `UPDATE normalized_ratings 
       SET status = 'PUBLISHED', updated_at = NOW()
       WHERE employee_id IN (${publishPlaceholders}) 
         AND quarter = ? 
         AND performance_cycle_id = ?
         ${whereClause}`,
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
// Update normalized rating and/or calibrated rating (for rejected ratings)
// HR can edit both final_normalized_rating and calibrated_rating independently
router.put('/hr/normalized-rating/:id', authMiddleware, requireRole(['hr_admin', 'hrbp', 'system_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { final_normalized_rating, calibrated_rating } = req.body;
    
    // At least one field must be provided
    if (final_normalized_rating === undefined && calibrated_rating === undefined) {
      return res.status(400).json({ error: 'At least one of final_normalized_rating or calibrated_rating must be provided' });
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
    
    // Build dynamic UPDATE query based on what's provided
    const updateFields = [];
    const updateParams = [];
    let paramIndex = 1;
    
    if (final_normalized_rating !== undefined) {
      updateFields.push(`final_normalized_rating = $${paramIndex++}`);
      updateParams.push(parseFloat(final_normalized_rating));
    }
    
    if (calibrated_rating !== undefined) {
      updateFields.push(`calibrated_rating = $${paramIndex++}`);
      updateParams.push(calibrated_rating === null ? null : parseFloat(calibrated_rating));
    }
    
    // Always update status to DRAFT and updated_at
    updateFields.push(`status = 'DRAFT'`);
    updateFields.push(`updated_at = NOW()`);
    
    // Add id as last parameter for WHERE clause
    updateParams.push(id);
    
    const updateQuery = `
      UPDATE normalized_ratings 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
        AND status IN ('REJECTED', 'DRAFT', 'SENT_TO_MANAGER')
        AND status != 'PUBLISHED'
      RETURNING id, final_normalized_rating, calibrated_rating
    `;
    
    const result = await query(updateQuery, updateParams);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Rating not found or cannot be updated' });
    }
    
    const updatedData = result.rows[0];
    const messages = [];
    
    if (final_normalized_rating !== undefined) {
      messages.push('Normalized rating updated');
    }
    if (calibrated_rating !== undefined) {
      messages.push('Calibrated rating updated');
    }
    
    res.json({ 
      data: { 
        id: updatedData.id, 
        final_normalized_rating: updatedData.final_normalized_rating,
        calibrated_rating: updatedData.calibrated_rating,
        message: messages.join('. ') + '.'
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
      `SELECT emp_code FROM employees WHERE id = $1`,
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
      WHERE nr.performance_cycle_id = $1 
        AND nr.quarter = $2
        AND nr.status = 'SENT_TO_MANAGER'
        AND (
          e.manager_code = $3
          OR EXISTS (
            SELECT 1 FROM employee_quarter_transitions eqt
            WHERE eqt.employee_id = e.id
              AND eqt.new_manager_id = $4
              AND eqt.cycle_id = nr.performance_cycle_id
              AND eqt.quarter = nr.quarter
              AND eqt.transition_date <= CURRENT_DATE
          )
        )
      ORDER BY e.emp_code`,
      [cycle_id, parseInt(quarter), managerEmpCode, manager_id]
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
// Supports period_type and transition_id for transition-specific ratings
router.get('/employee/normalized-rating', authMiddleware, async (req, res) => {
  try {
    const { employee_id, quarter, cycle_id, period_type, transition_id } = req.query;
    
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
    
    // Get published calibrated rating
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

// POST /api/evaluations/hr-approve-review
// HR approves a manager review and releases it to employee
// Special handling: Pre-transition reviews are approved directly (no normalization)
// Post-transition aggregated reviews go through normalization workflow
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

    // First, get the review to check if it's a pre-transition review
    const reviewCheck = await query(
      `SELECT period_type, transition_id, status 
       FROM quarterly_manager_reviews 
       WHERE id = $1`,
      [manager_review_id]
    );

    if (reviewCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }

    const review = reviewCheck.rows[0];

    // Pre-transition reviews: Approve directly (no normalization/calibration)
    if (review.period_type === 'pre_transition' && review.transition_id) {
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

      console.log(`[HR Approve] Pre-transition review ${manager_review_id} approved directly (no normalization)`);
      return res.json({ 
        data: result.rows[0],
        message: 'Pre-transition review approved. No normalization required.',
        requires_normalization: false
      });
    }

    // Post-transition aggregated reviews: Should go through normalization first
    // But if HR wants to approve directly, allow it (for edge cases)
    if (review.period_type === 'post_transition' && review.transition_id) {
      // Check if normalization has been done
      const normalizedCheck = await query(
        `SELECT id, status, final_normalized_rating 
         FROM normalized_ratings 
         WHERE employee_id = (
           SELECT employee_id FROM quarterly_manager_reviews WHERE id = $1
         )
         AND quarter = (SELECT quarter FROM quarterly_manager_reviews WHERE id = $1)
         AND performance_cycle_id = (SELECT cycle_id FROM quarterly_manager_reviews WHERE id = $1)
         AND status IN ('DRAFT', 'SENT_TO_MANAGER', 'ACCEPTED', 'PUBLISHED')`,
        [manager_review_id]
      );

      if (normalizedCheck.rows.length === 0) {
        // No normalization yet - approve directly but warn HR
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

        console.log(`[HR Approve] Post-transition review ${manager_review_id} approved without normalization (edge case)`);
        return res.json({ 
          data: result.rows[0],
          message: 'Post-transition review approved. Consider normalizing before final approval.',
          requires_normalization: true,
          warning: 'Normalization recommended for post-transition reviews'
        });
      }
    }

    // Standard approval for non-transition or full-quarter reviews
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

// ========== PERIOD RATINGS ==========

// GET /api/evaluations/period-ratings - Get period ratings for an employee
router.get('/period-ratings', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, quarter, period_type } = req.query;
    
    if (!employee_id || !cycle_id) {
      return res.status(400).json({ error: 'employee_id and cycle_id are required' });
    }
    
    let sql = `
      SELECT 
        id,
        employee_id,
        cycle_id,
        quarter,
        transition_id,
        period_type,
        period_start_date,
        period_end_date,
        period_days,
        weighted_avg_rating,
        manager_id,
        is_final,
        created_at,
        updated_at
      FROM quarterly_period_ratings
      WHERE employee_id = $1 AND cycle_id = $2
    `;
    
    const params = [employee_id, cycle_id];
    let paramIndex = 3;
    
    if (quarter) {
      sql += ` AND quarter = $${paramIndex++}`;
      params.push(parseInt(quarter));
    }
    
    if (period_type) {
      sql += ` AND period_type = $${paramIndex++}::period_type`;
      params.push(period_type);
    }
    
    sql += ` ORDER BY quarter, period_type`;
    
    const result = await query(sql, params);
    
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Get period ratings error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

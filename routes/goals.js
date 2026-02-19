import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware, hasAnyRole } from '../middleware/auth.js';
import { checkManagerOrDelegate } from './delegations.js';
import { canPerformTransitionActions, getManagerRoleForTransition } from '../services/transitionService.js';

const router = express.Router();

// GET /api/goals - Get goals with filters
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, status, type, quarter, period_type, transition_id } = req.query;
    
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
    
    // Explicitly select all columns including quarter to ensure it's returned
    let sql = `SELECT 
      id, employee_id, cycle_id, kra_id, kpi_template_id, title, description, 
      goal_type, metric_type, target_value, weight, calibration, due_date, 
      status, quarter, period_type, transition_id, period_start_date, period_end_date, 
      created_at, updated_at 
    FROM goals WHERE 1=1`;
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
    if (type) {
      sql += ` AND type = $${idx++}`;
      params.push(type);
    }
    if (quarter) {
      sql += ` AND quarter = $${idx++}`;
      params.push(parseInt(quarter));
    }
    if (period_type) {
      // Special handling for pre_transition: if period_type=pre_transition, also include NULL and full_quarter
      // This ensures we get old goals (period_type IS NULL) and full_quarter goals in the pre-transition tab
      if (period_type === 'pre_transition') {
        sql += ` AND (period_type = $${idx}::period_type OR period_type IS NULL OR period_type = 'full_quarter'::period_type)`;
        params.push(period_type);
        idx++;
      } else {
        sql += ` AND period_type = $${idx++}::period_type`;
        params.push(period_type);
      }
    }
    // Apply transition_id filtering only for manager views (not for employee viewing own goals)
    // When a manager views another employee's goals, we need to filter by transition_id
    // When an employee views their own goals, they should see all their goals (pre + post + full_quarter)
    const isManagerViewingOtherEmployee = managerId && employee_id && cycle_id && employee_id !== managerId;
    
    if (transition_id) {
      // If period_type is pre_transition, also include goals with transition_id IS NULL (old goals)
      // This ensures old goals (created before transition) are shown in pre-transition tab
      if (period_type === 'pre_transition') {
        sql += ` AND (transition_id = $${idx} OR transition_id IS NULL)`;
        params.push(transition_id);
        idx++;
      } else {
        sql += ` AND transition_id = $${idx++}`;
        params.push(transition_id);
      }
    } else if (isManagerViewingOtherEmployee && !period_type) {
      // When transition_id is not provided AND it's a manager viewing another employee AND period_type is not specified,
      // only return goals where transition_id IS NULL
      // This ensures we only get pre-transition and full_quarter goals (not post-transition)
      // However, if period_type is specified (e.g., 'pre_transition'), we should not filter by transition_id IS NULL
      // because pre-transition goals have a transition_id set
      sql += ` AND transition_id IS NULL`;
    }
    // If employee is viewing their own goals and transition_id is not provided, don't filter by transition_id
    // This allows employees to see all their goals (pre + post + full_quarter)

    // Apply manager role filtering if viewing another employee's data
    // If quarter is provided, filter for that specific quarter
    // If quarter is not provided, check all quarters for transitions
    // Note: If new_manager_id is null/empty, it is considered as the same manager
    if (isManagerViewingOtherEmployee) {
      if (quarter) {
        // Quarter is provided - filter for this specific quarter
        const managerRole = await getManagerRoleForTransition(managerId, employee_id, cycle_id, parseInt(quarter));
        
        if (managerRole === 'old_manager') {
          // Old manager: only pre-transition and full_quarter goals (NOT post-transition)
          // Old manager should NOT see new goals (post-transition goals)
          sql += ` AND (period_type IS NULL OR period_type = 'full_quarter'::period_type OR period_type = 'pre_transition'::period_type)`;
        } else if (managerRole === 'new_manager') {
          // New manager: only post-transition goals
          sql += ` AND (period_type IS NULL OR period_type = 'full_quarter'::period_type OR period_type = 'post_transition'::period_type)`;
        } else if (managerRole === 'same_manager') {
          // Same manager: both pre and post-transition (no additional filter needed)
        }
        // If managerRole is null, user is not involved in transition, show all data
      } else {
        // Quarter not provided - check all quarters for transitions and filter accordingly
        // This is a fallback for when quarter is not specified
        const transitionsResult = await query(
          `SELECT quarter, old_manager_id, new_manager_id 
           FROM employee_quarter_transitions 
           WHERE employee_id = $1 AND cycle_id = $2`,
          [employee_id, cycle_id]
        );
        
        if (transitionsResult.rows.length > 0) {
          // Check if manager is involved in any transition
          // Note: If new_manager_id is null/empty, it is considered as the same manager
          const isOldManager = transitionsResult.rows.some(t => {
            const isOld = t.old_manager_id === managerId;
            const isNewManagerIdEmpty = !t.new_manager_id || t.new_manager_id === '';
            // Only treat as old_manager if managers are different (new_manager_id exists and is different)
            // If new_manager_id is null/empty, it's same_manager, so don't filter
            return isOld && !isNewManagerIdEmpty && t.new_manager_id !== t.old_manager_id;
          });
          const isNewManager = transitionsResult.rows.some(t => t.new_manager_id && t.new_manager_id === managerId && t.new_manager_id !== t.old_manager_id);
          
          if (isOldManager && !isNewManager) {
            // Manager is only old manager (different managers): only pre-transition and full_quarter goals (NOT post-transition)
            // Old manager should NOT see new goals (post-transition goals)
            sql += ` AND (period_type IS NULL OR period_type = 'full_quarter'::period_type OR period_type = 'pre_transition'::period_type)`;
          } else if (isNewManager && !isOldManager) {
            // Manager is only new manager (different managers): only post-transition goals
            sql += ` AND (period_type IS NULL OR period_type = 'full_quarter'::period_type OR period_type = 'post_transition'::period_type)`;
          }
          // If manager is both old and new (same_manager) or neither, show all data
        }
      }
    }

    sql += ' ORDER BY created_at DESC';
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/goals/my - Get current user's goals
router.get('/my', authMiddleware, async (req, res) => {
  try {
    const { cycle_id, quarter } = req.query;
    
    // First get employee ID for current user
    const empResult = await query(
      'SELECT id FROM employees WHERE profile_id = $1',
      [req.user.userId]
    );
    
    if (empResult.rows.length === 0) {
      return res.json({ data: [] });
    }
    
    let sql = 'SELECT * FROM goals WHERE employee_id = $1';
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
    sql += ' ORDER BY created_at DESC';
    
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/goals/pending-approvals - For managers (includes delegated)
router.get('/pending-approvals', authMiddleware, async (req, res) => {
  try {
    const { cycle_id, quarter } = req.query;
    
    // Get manager's employee record (need emp_code for manager_code query)
    const empResult = await query(
      'SELECT id, emp_code FROM employees WHERE profile_id = $1',
      [req.user.userId]
    );
    
    if (empResult.rows.length === 0) {
      return res.json({ data: [], count: 0 });
    }
    
    const managerId = empResult.rows[0].id;
    const managerCode = empResult.rows[0].emp_code;
    
    // Build base parameters array
    // Note: The database.js function converts $1, $2, $3 to ? placeholders.
    // Since $2 (managerId) appears 5 times in the query, we need to account for this.
    // The conversion replaces all $N with ? in reverse order, but the final ? placeholders
    // appear in the order they exist in the SQL text.
    // Each ? maps to the next element in the replacements array (0-indexed).
    // So we need: [managerCode ($1), managerId ($2-1st), managerId ($2-2nd), managerId ($2-3rd), managerId ($2-4th), managerId ($2-5th), cycle_id ($3 if provided), quarter ($4 if provided)]
    const params = [
      managerCode,  // $1 (appears once) -> 1st ?
      managerId,    // $2 (1st occurrence) -> 2nd ?
      managerId,    // $2 (2nd occurrence) -> 3rd ?
      managerId,    // $2 (3rd occurrence) -> 4th ?
      managerId,    // $2 (4th occurrence) -> 5th ?
      managerId     // $2 (5th occurrence) -> 6th ?
    ];
    let paramIndex = 3;
    
    // Build WHERE conditions dynamically
    let cycleCondition = '';
    let quarterCondition = '';
    
    if (cycle_id) {
      cycleCondition = ` AND g.cycle_id = $${paramIndex}`;
      params.push(cycle_id);
      paramIndex++;
    }
    if (quarter) {
      quarterCondition = ` AND g.quarter = $${paramIndex}`;
      params.push(parseInt(quarter));
      paramIndex++;
    }
    
    let sql = `
      SELECT DISTINCT g.*, e.full_name, e.email
      FROM goals g
      JOIN employees e ON g.employee_id = e.id
      WHERE g.status = 'submitted'
        AND (
          (e.manager_code = $1 AND (g.period_type IS NULL OR g.period_type = 'full_quarter'::period_type))
          OR EXISTS (
            SELECT 1 FROM delegations d
            WHERE d.delegate_id = $2
              AND d.reportee_id = e.id
              AND d.cycle_id = g.cycle_id
              AND d.quarter = g.quarter
              AND d.revoked_at IS NULL
          )
          OR EXISTS (
            -- New manager can see post-transition goals
            -- Use manager_history for accurate manager tracking (not dependent on employees.manager_code)
            SELECT 1 FROM employee_quarter_transitions eqt
            LEFT JOIN manager_history mh ON mh.transition_id = eqt.id
            WHERE eqt.employee_id = e.id
              AND eqt.cycle_id = g.cycle_id
              AND eqt.quarter = g.quarter
              AND eqt.transition_date <= CURRENT_DATE
              AND g.period_type = 'post_transition'::period_type
              AND g.transition_id = eqt.id
              AND (
                -- Check manager_history first (more accurate), fallback to transition table
                (mh.new_manager_id = $2) OR (mh.new_manager_id IS NULL AND eqt.new_manager_id = $2)
              )
          )
          OR EXISTS (
            -- Old manager can see pre-transition goals
            -- Use manager_history for accurate manager tracking (not dependent on employees.manager_code)
            SELECT 1 FROM employee_quarter_transitions eqt
            LEFT JOIN manager_history mh ON mh.transition_id = eqt.id
            WHERE eqt.employee_id = e.id
              AND eqt.cycle_id = g.cycle_id
              AND eqt.quarter = g.quarter
              AND g.period_type = 'pre_transition'::period_type
              AND g.transition_id = eqt.id
              AND (
                -- Check manager_history first (more accurate), fallback to transition table
                (mh.old_manager_id = $2) OR (mh.old_manager_id IS NULL AND eqt.old_manager_id = $2)
              )
          )
        )
        ${cycleCondition}
        ${quarterCondition}
    `;
    
    const result = await query(sql, params);
    const uniqueEmployees = new Set(result.rows.map(row => row.employee_id));
    res.json({ data: result.rows, count: uniqueEmployees.size});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/goals/clone - Clone goals from one quarter to another
// IMPORTANT: This must be defined BEFORE /:id route to avoid matching "clone" as an ID
router.post('/clone', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, source_quarter, target_quarter } = req.body;

    if (!employee_id || !cycle_id || !source_quarter || !target_quarter) {
      return res.status(400).json({ error: 'Missing required fields: employee_id, cycle_id, source_quarter, target_quarter' });
    }

    if (source_quarter === target_quarter) {
      return res.status(400).json({ error: 'Source and target quarters must be different' });
    }

    if (source_quarter < 1 || source_quarter > 4 || target_quarter < 1 || target_quarter > 4) {
      return res.status(400).json({ error: 'Quarter must be between 1 and 4' });
    }

    // Check if target quarter already has goals
    const existingGoals = await query(
      `SELECT g.id FROM goals g
       INNER JOIN kras k ON g.kra_id = k.id
       WHERE k.employee_id = $1 AND k.cycle_id = $2 AND k.quarter = $3`,
      [employee_id, cycle_id, target_quarter]
    );

    if (existingGoals.rows.length > 0) {
      return res.status(400).json({ error: `Target quarter (Q${target_quarter}) already has goals. Please delete existing goals before cloning.` });
    }

    // Get all KRAs from source quarter
    const sourceKRAs = await query(
      'SELECT * FROM kras WHERE employee_id = $1 AND cycle_id = $2 AND quarter = $3',
      [employee_id, cycle_id, source_quarter]
    );

    if (sourceKRAs.rows.length === 0) {
      return res.status(404).json({ error: `No goals found in source quarter (Q${source_quarter})` });
    }

    const clonedKRAs = [];
    const clonedKPIs = [];

    // Clone each KRA and its KPIs
    for (const sourceKRA of sourceKRAs.rows) {
      // Create new KRA for target quarter
      const newKRA = await query(
        `INSERT INTO kras (id, employee_id, cycle_id, kra_template_id, title, description, weight, status, quarter, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
         RETURNING *`,
        [
          sourceKRA.employee_id,
          sourceKRA.cycle_id,
          sourceKRA.kra_template_id,
          sourceKRA.title,
          sourceKRA.description,
          sourceKRA.weight,
          'draft', // Reset status to draft for cloned KRA
          target_quarter
        ]
      );

      const clonedKRA = newKRA.rows[0];
      clonedKRAs.push(clonedKRA);

      // Get all KPIs for this KRA from source quarter
      const sourceKPIs = await query(
        'SELECT * FROM goals WHERE kra_id = $1 AND quarter = $2',
        [sourceKRA.id, source_quarter]
      );

      // Clone each KPI
      for (const sourceKPI of sourceKPIs.rows) {
        // Handle calibration data - PostgreSQL JSONB returns as object, need to stringify for INSERT
        let calibrationJson = null;
        if (sourceKPI.calibration !== null && sourceKPI.calibration !== undefined) {
          if (typeof sourceKPI.calibration === 'string') {
            // Already a JSON string, validate it
            try {
              JSON.parse(sourceKPI.calibration);
              calibrationJson = sourceKPI.calibration;
            } catch (e) {
              // Invalid JSON string, set to null
              calibrationJson = null;
            }
          } else {
            // PostgreSQL JSONB returns as object/array, convert to JSON string
            calibrationJson = JSON.stringify(sourceKPI.calibration);
          }
        }

        const newKPI = await query(
          `INSERT INTO goals (id, employee_id, cycle_id, kra_id, kpi_template_id, title, description, goal_type, metric_type, target_value, weight, calibration, due_date, status, quarter, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
           RETURNING *`,
          [
            sourceKPI.employee_id,
            sourceKPI.cycle_id,
            clonedKRA.id, // Link to new KRA
            sourceKPI.kpi_template_id,
            sourceKPI.title,
            sourceKPI.description,
            sourceKPI.goal_type,
            sourceKPI.metric_type,
            sourceKPI.target_value,
            sourceKPI.weight,
            calibrationJson, // Use properly formatted calibration JSON
            sourceKPI.due_date,
            'draft', // Reset status to draft for cloned KPI
            target_quarter
          ]
        );

        clonedKPIs.push(newKPI.rows[0]);
      }
    }

    res.json({
      data: {
        kras: clonedKRAs,
        kpis: clonedKPIs
      },
      message: `Successfully cloned ${clonedKRAs.length} KRAs and ${clonedKPIs.length} KPIs from Q${source_quarter} to Q${target_quarter}`
    });
  } catch (error) {
    console.error('Error cloning goals:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== GOAL REJECTION WORKFLOW ==========
// IMPORTANT: These routes must be defined BEFORE /:id route to avoid matching "goal-rejections", "reject-goal", etc. as IDs

// GET /api/goals/goal-rejections
// Get rejection status for goals (KRAs/KPIs) for a given employee/quarter
router.get('/goal-rejections', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, quarter, kra_id, goal_id } = req.query;

    let sql = `
      SELECT 
        gr.*,
        k.title as kra_title,
        g.title as goal_title
      FROM goal_rejections gr
      LEFT JOIN kras k ON k.id = gr.kra_id
      LEFT JOIN goals g ON g.id = gr.goal_id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (employee_id) {
      sql += ` AND gr.employee_id = $${idx++}`;
      params.push(employee_id);
    }
    if (cycle_id) {
      sql += ` AND gr.cycle_id = $${idx++}`;
      params.push(cycle_id);
    }
    if (quarter) {
      sql += ` AND gr.quarter = $${idx++}`;
      params.push(parseInt(quarter));
    }
    if (kra_id) {
      sql += ` AND gr.kra_id = $${idx++}`;
      params.push(kra_id);
    }
    if (goal_id) {
      sql += ` AND gr.goal_id = $${idx++}`;
      params.push(goal_id);
    }

    sql += ' ORDER BY gr.rejected_at DESC';
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching goal rejections:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/goals/reject-goal
// Manager rejects a specific goal (KRA or KPI)
router.post('/reject-goal', authMiddleware, async (req, res) => {
  try {
    const { kra_id, goal_id, rejection_reason, quarter, cycle_id, employee_id } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!rejection_reason || !quarter || !cycle_id || !employee_id) {
      return res.status(400).json({ error: 'rejection_reason, quarter, cycle_id, and employee_id are required' });
    }

    if (!kra_id && !goal_id) {
      return res.status(400).json({ error: 'Either kra_id or goal_id must be provided' });
    }

    if (kra_id && goal_id) {
      return res.status(400).json({ error: 'Cannot reject both KRA and KPI in the same request' });
    }

    // Get current user's employee ID
    const currentUserEmpResult = await query(
      'SELECT id FROM employees WHERE profile_id = $1',
      [userId]
    );

    if (currentUserEmpResult.rows.length === 0) {
      return res.status(404).json({ error: 'Current user employee record not found' });
    }

    const rejectedBy = currentUserEmpResult.rows[0].id;

    // Verify manager is authorized to reject (must be manager or delegate)
    const auth = await checkManagerOrDelegate(
      userId,
      employee_id,
      cycle_id,
      parseInt(quarter)
    );

    if (!auth.isAuthorized) {
      return res.status(403).json({ error: 'Not authorized to reject this goal' });
    }

    // Determine final kra_id and goal_id values for storage
    let finalKraId = kra_id || null;
    let finalGoalId = goal_id || null;

    // Verify the KRA or goal exists and get its details
    if (finalGoalId) {
      const goalCheck = await query(
        'SELECT id, kra_id, status FROM goals WHERE id = $1',
        [finalGoalId]
      );

      if (goalCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Goal (KPI) not found' });
      }

      // Only allow rejecting submitted goals (not approved or other statuses)
      if (goalCheck.rows[0].status !== 'submitted') {
        if (goalCheck.rows[0].status === 'approved') {
          return res.status(400).json({ error: 'Cannot reject approved goals' });
        }
        return res.status(400).json({ error: 'Can only reject submitted goals' });
      }

      finalKraId = null; // Ensure finalKraId is null when rejecting a KPI
    }

    if (finalKraId && !finalGoalId) {
      const kraCheck = await query(
        'SELECT id, status FROM kras WHERE id = $1',
        [finalKraId]
      );

      if (kraCheck.rows.length === 0) {
        return res.status(404).json({ error: 'KRA not found' });
      }

      // Only allow rejecting submitted KRAs (not approved or other statuses)
      if (kraCheck.rows[0].status !== 'submitted') {
        if (kraCheck.rows[0].status === 'approved') {
          return res.status(400).json({ error: 'Cannot reject approved KRAs' });
        }
        return res.status(400).json({ error: 'Can only reject submitted KRAs' });
      }

      finalGoalId = null; // Ensure finalGoalId is null when rejecting a KRA
    }

    // Check if this goal has already been rejected by this manager in this quarter
    let existingRejectionCheck;
    if (finalGoalId) {
      existingRejectionCheck = await query(
        `SELECT 1
         FROM goal_rejections
         WHERE employee_id = $1
           AND cycle_id = $2
           AND quarter = $3
           AND rejected_by = $4
           AND goal_id = $5
           AND resubmitted_at IS NULL
         LIMIT 1`,
        [
          employee_id,
          cycle_id,
          Number(quarter),
          rejectedBy,
          finalGoalId
        ]
      );
    } else if (finalKraId) {
      existingRejectionCheck = await query(
        `SELECT 1
         FROM goal_rejections
         WHERE employee_id = $1
           AND cycle_id = $2
           AND quarter = $3
           AND rejected_by = $4
           AND kra_id = $5
           AND resubmitted_at IS NULL
         LIMIT 1`,
        [
          employee_id,
          cycle_id,
          parseInt(quarter),
          rejectedBy,
          finalKraId
        ]
      );
    } else {
      return res.status(400).json({ error: 'Either kra_id or goal_id must be provided' });
    }

    if (existingRejectionCheck && existingRejectionCheck.rows && existingRejectionCheck.rows.length > 0) {
      return res.status(400).json({
        error: 'This goal has already been rejected once in this quarter. Cannot reject again.',
        hint: 'A manager can only reject a specific goal once per quarter. After employee resubmission, manager must accept or proceed with approval.'
      });
    }

    // Create rejection record
    let rejectionResult;
    try {
      rejectionResult = await query(
        `INSERT INTO goal_rejections 
         (id, kra_id, goal_id, quarter, cycle_id, employee_id, rejected_by, rejection_reason, rejected_at, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW())
         RETURNING *`,
        [
          finalKraId,
          finalGoalId,
          parseInt(quarter),
          cycle_id,
          employee_id,
          rejectedBy,
          rejection_reason
        ]
      );
    } catch (dbError) {
      // Handle unique constraint violation at database level
      if (dbError.code === '23505' || dbError.message?.includes('unique') || dbError.message?.includes('duplicate')) {
        return res.status(400).json({
          error: 'This goal has already been rejected once in this quarter. Cannot reject again.',
          hint: 'A manager can only reject a specific goal once per quarter. After employee resubmission, manager must accept or proceed with approval.'
        });
      }
      throw dbError; // Re-throw if it's a different error
    }

    // Update goal/KRA status to 'returned'
    if (finalGoalId) {
      await query(
        `UPDATE goals SET status = 'returned', manager_comments = $1, updated_at = NOW() WHERE id = $2`,
        [rejection_reason, finalGoalId]
      );
    } else if (finalKraId) {
      await query(
        `UPDATE kras SET status = 'returned', manager_comments = $1, updated_at = NOW() WHERE id = $2`,
        [rejection_reason, finalKraId]
      );
    }

    res.json({ data: rejectionResult.rows[0] });
  } catch (error) {
    console.error('Error rejecting goal:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/goals/resubmit-goal
// Mark rejected goal as resubmitted when employee updates it
router.post('/resubmit-goal', authMiddleware, async (req, res) => {
  try {
    const { rejection_id } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!rejection_id) {
      return res.status(400).json({ error: 'rejection_id is required' });
    }

    // Get current user's employee ID
    const currentUserEmpResult = await query(
      'SELECT id FROM employees WHERE profile_id = $1',
      [userId]
    );

    if (currentUserEmpResult.rows.length === 0) {
      return res.status(404).json({ error: 'Current user employee record not found' });
    }

    const employeeId = currentUserEmpResult.rows[0].id;

    // Verify the rejection belongs to this employee
    const rejectionCheck = await query(
      'SELECT employee_id FROM goal_rejections WHERE id = $1',
      [rejection_id]
    );

    if (rejectionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Rejection not found' });
    }

    if (rejectionCheck.rows[0].employee_id !== employeeId) {
      return res.status(403).json({ error: 'Not authorized to resubmit this rejection' });
    }

    // Mark as resubmitted
    const result = await query(
      `UPDATE goal_rejections 
       SET resubmitted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND resubmitted_at IS NULL
       RETURNING *`,
      [rejection_id]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Rejection not found or already resubmitted' });
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Error resubmitting goal:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/goals/reject-all-goals
// Manager rejects all goals (KRAs and KPIs) for an employee in a quarter
router.post('/reject-all-goals', authMiddleware, async (req, res) => {
  try {
    const { rejection_reason, quarter, cycle_id, employee_id, kra_ids, goal_ids } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!rejection_reason || !quarter || !cycle_id || !employee_id) {
      return res.status(400).json({ error: 'rejection_reason, quarter, cycle_id, and employee_id are required' });
    }

    if ((!kra_ids || kra_ids.length === 0) && (!goal_ids || goal_ids.length === 0)) {
      return res.status(400).json({ error: 'At least one kra_id or goal_id must be provided' });
    }

    // Get current user's employee ID
    const currentUserEmpResult = await query(
      'SELECT id FROM employees WHERE profile_id = $1',
      [userId]
    );

    if (currentUserEmpResult.rows.length === 0) {
      return res.status(404).json({ error: 'Current user employee record not found' });
    }

    const rejectedBy = currentUserEmpResult.rows[0].id;

    // Verify manager is authorized to reject (must be manager or delegate)
    const auth = await checkManagerOrDelegate(
      userId,
      employee_id,
      cycle_id,
      parseInt(quarter)
    );

    if (!auth.isAuthorized) {
      return res.status(403).json({ error: 'Not authorized to reject goals for this employee' });
    }

    const rejectedKras = [];
    const rejectedGoals = [];
    const errors = [];

    // Reject all KRAs
    if (kra_ids && kra_ids.length > 0) {
      for (const kraId of kra_ids) {
        try {
          // Check if KRA exists and is submitted
          const kraCheck = await query(
            'SELECT id, status FROM kras WHERE id = $1 AND employee_id = $2 AND cycle_id = $3 AND quarter = $4',
            [kraId, employee_id, cycle_id, parseInt(quarter)]
          );

          if (kraCheck.rows.length === 0) {
            errors.push({ type: 'kra', id: kraId, error: 'KRA not found' });
            continue;
          }

          // Only allow rejecting submitted KRAs (not approved or other statuses)
          if (kraCheck.rows[0].status !== 'submitted') {
            if (kraCheck.rows[0].status === 'approved') {
              errors.push({ type: 'kra', id: kraId, error: 'Cannot reject approved KRAs' });
            } else {
              errors.push({ type: 'kra', id: kraId, error: 'Can only reject submitted KRAs' });
            }
            continue;
          }

          // Check if already rejected
          const existingRejection = await query(
            `SELECT 1 FROM goal_rejections
             WHERE employee_id = $1 AND cycle_id = $2 AND quarter = $3 AND rejected_by = $4 AND kra_id = $5 AND resubmitted_at IS NULL
             LIMIT 1`,
            [employee_id, cycle_id, parseInt(quarter), rejectedBy, kraId]
          );

          if (existingRejection.rows.length > 0) {
            errors.push({ type: 'kra', id: kraId, error: 'KRA has already been rejected' });
            continue;
          }

          // Create rejection record
          const rejectionResult = await query(
            `INSERT INTO goal_rejections 
             (id, kra_id, goal_id, quarter, cycle_id, employee_id, rejected_by, rejection_reason, rejected_at, created_at, updated_at)
             VALUES (gen_random_uuid(), $1, NULL, $2, $3, $4, $5, $6, NOW(), NOW(), NOW())
             RETURNING *`,
            [kraId, parseInt(quarter), cycle_id, employee_id, rejectedBy, rejection_reason]
          );

          // Update KRA status to 'returned'
          await query(
            `UPDATE kras SET status = 'returned', manager_comments = $1, updated_at = NOW() WHERE id = $2`,
            [rejection_reason, kraId]
          );

          rejectedKras.push(kraId);
        } catch (error) {
          console.error(`Error rejecting KRA ${kraId}:`, error);
          errors.push({ type: 'kra', id: kraId, error: error.message || 'Failed to reject KRA' });
        }
      }
    }

    // Reject all Goals (KPIs)
    if (goal_ids && goal_ids.length > 0) {
      for (const goalId of goal_ids) {
        try {
          // Check if goal exists and is submitted
          const goalCheck = await query(
            'SELECT id, status FROM goals WHERE id = $1 AND employee_id = $2 AND cycle_id = $3 AND quarter = $4',
            [goalId, employee_id, cycle_id, parseInt(quarter)]
          );

          if (goalCheck.rows.length === 0) {
            errors.push({ type: 'goal', id: goalId, error: 'Goal (KPI) not found' });
            continue;
          }

          // Only allow rejecting submitted goals (not approved or other statuses)
          if (goalCheck.rows[0].status !== 'submitted') {
            if (goalCheck.rows[0].status === 'approved') {
              errors.push({ type: 'goal', id: goalId, error: 'Cannot reject approved goals' });
            } else {
              errors.push({ type: 'goal', id: goalId, error: 'Can only reject submitted goals' });
            }
            continue;
          }

          // Check if already rejected
          const existingRejection = await query(
            `SELECT 1 FROM goal_rejections
             WHERE employee_id = $1 AND cycle_id = $2 AND quarter = $3 AND rejected_by = $4 AND goal_id = $5 AND resubmitted_at IS NULL
             LIMIT 1`,
            [employee_id, cycle_id, parseInt(quarter), rejectedBy, goalId]
          );

          if (existingRejection.rows.length > 0) {
            errors.push({ type: 'goal', id: goalId, error: 'Goal has already been rejected' });
            continue;
          }

          // Create rejection record
          const rejectionResult = await query(
            `INSERT INTO goal_rejections 
             (id, kra_id, goal_id, quarter, cycle_id, employee_id, rejected_by, rejection_reason, rejected_at, created_at, updated_at)
             VALUES (gen_random_uuid(), NULL, $1, $2, $3, $4, $5, $6, NOW(), NOW(), NOW())
             RETURNING *`,
            [goalId, parseInt(quarter), cycle_id, employee_id, rejectedBy, rejection_reason]
          );

          // Update goal status to 'returned'
          await query(
            `UPDATE goals SET status = 'returned', manager_comments = $1, updated_at = NOW() WHERE id = $2`,
            [rejection_reason, goalId]
          );

          rejectedGoals.push(goalId);
        } catch (error) {
          console.error(`Error rejecting goal ${goalId}:`, error);
          errors.push({ type: 'goal', id: goalId, error: error.message || 'Failed to reject goal' });
        }
      }
    }

    res.json({
      data: {
        rejected_kras: rejectedKras,
        rejected_goals: rejectedGoals,
        errors: errors,
        total_rejected: rejectedKras.length + rejectedGoals.length,
        total_errors: errors.length
      }
    });
  } catch (error) {
    console.error('Error rejecting all goals:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/goals/:id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM goals WHERE id = $1 ',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/goals
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, kra_id, kpi_template_id, goal_type, title, description, weight, target_value, metric_type, due_date, status, calibration, quarter, period_type, transition_id } = req.body;
    
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

    // Auto-detect transition if not explicitly provided
    let periodType = period_type || null;
    let transitionId = transition_id || null;
    let periodStartDate = null;
    let periodEndDate = null;
    let hasActiveTransition = false;

    if (employee_id && cycle_id && quarter && !periodType && !transitionId) {
      // Check if there's an active transition for this employee/cycle/quarter
      const transitionResult = await query(
        `SELECT id, transition_date
         FROM employee_quarter_transitions 
         WHERE employee_id = $1 AND cycle_id = $2 AND quarter = $3`,
        [employee_id, cycle_id, quarter]
      );

      if (transitionResult.rows.length > 0) {
        hasActiveTransition = true;
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
          
          if (now >= transitionDate) {
            // Goal is being created after transition, mark as post_transition
            // Note: Date validation is bypassed for post-transition goals per workflow requirements
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
            // Goal is being created before transition, mark as pre_transition
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
    } else if (transition_id || period_type) {
      // Transition explicitly provided - check if it exists
      hasActiveTransition = true;
    }
    
    const result = await query(
      `INSERT INTO goals (id, employee_id, cycle_id, kra_id, kpi_template_id, title, description, goal_type, metric_type, target_value, weight, calibration, due_date, status, quarter, period_type, transition_id, period_start_date, period_end_date, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::period_type, $16, $17, $18, NOW(), NOW())
       RETURNING *`,
      [
        employee_id ?? null,
        cycle_id ?? null,
        kra_id ?? null,
        kpi_template_id ?? null,
        title ?? null,
        description ?? null,
        goal_type || 'kpi',
        metric_type || 'number',
        target_value ?? null,
        weight ?? null,
        calibrationJson,
        due_date ?? null,
        status || 'draft',
        quarter ?? null,
        periodType,
        transitionId,
        periodStartDate,
        periodEndDate
      ]
    );
    // Return response with transition info for frontend date validation bypass
    const responseData = result.rows[0];
    if (hasActiveTransition || transitionId) {
      // For transition employees: NO validation needed - they can set goals at any time
      // The only requirement is that a transition exists for this employee/cycle/quarter
      responseData.has_active_transition = true;
      responseData.date_validation_bypassed = true; // Frontend can use this to bypass date checks
    }
    
    res.status(201).json({ data: responseData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/goals/:id
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { kra_id, title, description, goal_type, metric_type, target_value, weight, due_date, status, manager_comments, calibration } = req.body;
    
    // Get current goal details including employee_id for authorization
    const currentGoalResult = await query(
      'SELECT employee_id, cycle_id, quarter, status, period_type, transition_id FROM goals WHERE id = $1',
      [req.params.id]
    );
    if (currentGoalResult.rows.length === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    
    const currentGoal = currentGoalResult.rows[0];
    const currentStatus = currentGoal.status;
    const isLocked = currentStatus === 'approved' || currentStatus === 'locked';
    
    // Authorization check
    if (currentGoal.employee_id && currentGoal.cycle_id && currentGoal.quarter) {
      // Get current user's employee ID
      const currentUserResult = await query(
        'SELECT id FROM employees WHERE profile_id = $1',
        [req.user.userId]
      );
      
      if (currentUserResult.rows.length > 0) {
        const currentUserId = currentUserResult.rows[0].id;
        const isEmployee = currentUserId === currentGoal.employee_id;
        
        // Employees can only update their own goals in specific cases:
        // 1. Submitting for approval (status: 'draft' or 'returned' -> 'submitted')
        // 2. Editing draft/returned goals (not changing status to 'approved')
        if (isEmployee) {
          // Employees cannot approve their own goals
          if (status === 'approved') {
            return res.status(403).json({ error: 'You cannot approve your own goal' });
          }
          
          // Employees can only submit draft/returned goals or edit draft/returned goals
          if (status === 'submitted') {
            // Allow submitting draft/returned goals for approval
            if (currentStatus !== 'draft' && currentStatus !== 'returned') {
              return res.status(403).json({ error: 'Can only submit draft or returned goals' });
            }
            // Allow the update - employee is submitting their own goal
          } else if (status && status !== 'draft' && status !== 'returned') {
            // Invalid status change for employee
            return res.status(403).json({ error: 'Invalid status change for employee' });
          } else if (currentStatus === 'submitted' || currentStatus === 'approved') {
            // Employee cannot edit submitted or approved goals (unless manager returned them)
            if (status !== 'returned') {
              return res.status(403).json({ error: 'Cannot edit submitted or approved goals' });
            }
          }
          // Allow the update - employee is submitting their own goal or editing their draft/returned goal
        } else {
          // Not the employee - check if user is HR/Admin or manager/delegate
          const isHRAdmin = await hasAnyRole(req.user.userId, ['hr_admin', 'system_admin']);
          
          // If not HR/Admin, check if user is manager or delegate (includes transition checks)
          if (!isHRAdmin) {
            const auth = await checkManagerOrDelegate(
              req.user.userId,
              currentGoal.employee_id,
              currentGoal.cycle_id,
              currentGoal.quarter
            );
            
            if (!auth.isAuthorized) {
              const errorMessage = status === 'approved' 
                ? 'Not authorized to approve this goal' 
                : 'Not authorized to update this goal';
              return res.status(403).json({ error: errorMessage });
            }
          }
        }
      }
    }
    
    // Validate and format calibration if provided
    let calibrationJson = undefined;
    if (calibration !== undefined) {
      if (isLocked) {
        return res.status(403).json({ error: 'Calibration cannot be modified after manager approval' });
      }
      
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
    
    if (kra_id !== undefined) {
      updates.push(`kra_id = $${paramIndex++}`);
      values.push(kra_id ?? null);
    }
    if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(title ?? null);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description ?? null);
    }
    if (goal_type !== undefined) {
      updates.push(`goal_type = $${paramIndex++}`);
      values.push(goal_type ?? null);
    }
    if (metric_type !== undefined) {
      updates.push(`metric_type = $${paramIndex++}`);
      values.push(metric_type ?? null);
    }
    if (target_value !== undefined) {
      updates.push(`target_value = $${paramIndex++}`);
      values.push(target_value ?? null);
    }
    if (weight !== undefined) {
      updates.push(`weight = $${paramIndex++}`);
      values.push(weight ?? null);
    }
    if (calibrationJson !== undefined) {
      updates.push(`calibration = $${paramIndex++}`);
      values.push(calibrationJson);
    }
    if (due_date !== undefined) {
      updates.push(`due_date = $${paramIndex++}`);
      values.push(due_date ?? null);
    }
    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(status ?? null);
    }
    if (manager_comments !== undefined) {
      updates.push(`manager_comments = $${paramIndex++}`);
      values.push(manager_comments ?? null);
    }
    
    updates.push(`updated_at = NOW()`);
    values.push(req.params.id);
    
    if (updates.length === 1) { // Only updated_at
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    const result = await query(
      `UPDATE goals SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/goals/:id/submit
router.post('/:id/submit', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      `UPDATE goals SET status = 'submitted', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/goals/:id/approve
router.post('/:id/approve', authMiddleware, async (req, res) => {
  try {
    // Get goal details including period_type and transition_id
    const goalResult = await query(
      'SELECT employee_id, cycle_id, quarter, period_type, transition_id FROM goals WHERE id = $1',
      [req.params.id]
    );
    
    if (goalResult.rows.length === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    
    const goal = goalResult.rows[0];
    
    // Get current user's employee ID
    const currentUserResult = await query(
      'SELECT id FROM employees WHERE profile_id = $1',
      [req.user.userId]
    );
    
    if (currentUserResult.rows.length === 0) {
      return res.status(403).json({ error: 'User not found' });
    }
    
    const currentUserId = currentUserResult.rows[0].id;
    
    // For transition goals, verify the correct manager is approving
    if (goal.period_type && goal.period_type !== 'full_quarter' && goal.transition_id) {
      const transitionResult = await query(
        'SELECT old_manager_id, new_manager_id FROM employee_quarter_transitions WHERE id = $1',
        [goal.transition_id]
      );
      
      if (transitionResult.rows.length > 0) {
        const transition = transitionResult.rows[0];
        
        // For pre-transition goals, only old manager can approve
        if (goal.period_type === 'pre_transition') {
          if (currentUserId !== transition.old_manager_id) {
            return res.status(403).json({ 
              error: 'Only the pre-transition manager can approve pre-transition goals' 
            });
          }
        }
        // For post-transition goals, only new manager can approve
        else if (goal.period_type === 'post_transition') {
          if (currentUserId !== transition.new_manager_id) {
            return res.status(403).json({ 
              error: 'Only the post-transition manager can approve post-transition goals' 
            });
          }
        }
      }
    }
    
    // Check if user is HR/Admin - they can approve any goal
    const isHRAdmin = await hasAnyRole(req.user.userId, ['hr_admin', 'system_admin']);
    
    // If not HR/Admin, check if user is manager or delegate (includes transition checks)
    if (!isHRAdmin) {
      const auth = await checkManagerOrDelegate(
        req.user.userId,
        goal.employee_id,
        goal.cycle_id,
        goal.quarter
      );
      
      if (!auth.isAuthorized) {
        return res.status(403).json({ error: 'Not authorized to approve this goal' });
      }
    }
    
    const result = await query(
      `UPDATE goals SET status = 'approved', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/goals/:id/return
router.post('/:id/return', authMiddleware, async (req, res) => {
  try {
    const { comments } = req.body;
    
    // Get goal details including period_type and transition_id
    const goalResult = await query(
      'SELECT employee_id, cycle_id, quarter, period_type, transition_id FROM goals WHERE id = $1',
      [req.params.id]
    );
    
    if (goalResult.rows.length === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    
    const goal = goalResult.rows[0];
    
    // Get current user's employee ID
    const currentUserResult = await query(
      'SELECT id FROM employees WHERE profile_id = $1',
      [req.user.userId]
    );
    
    if (currentUserResult.rows.length === 0) {
      return res.status(403).json({ error: 'User not found' });
    }
    
    const currentUserId = currentUserResult.rows[0].id;
    
    // For transition goals, verify the correct manager is returning
    if (goal.period_type && goal.period_type !== 'full_quarter' && goal.transition_id) {
      const transitionResult = await query(
        'SELECT old_manager_id, new_manager_id FROM employee_quarter_transitions WHERE id = $1',
        [goal.transition_id]
      );
      
      if (transitionResult.rows.length > 0) {
        const transition = transitionResult.rows[0];
        
        // For pre-transition goals, only old manager can return
        if (goal.period_type === 'pre_transition') {
          if (currentUserId !== transition.old_manager_id) {
            return res.status(403).json({ 
              error: 'Only the pre-transition manager can return pre-transition goals' 
            });
          }
        }
        // For post-transition goals, only new manager can return
        else if (goal.period_type === 'post_transition') {
          if (currentUserId !== transition.new_manager_id) {
            return res.status(403).json({ 
              error: 'Only the post-transition manager can return post-transition goals' 
            });
          }
        }
      }
    }
    
    // Check if user is manager or delegate (includes transition checks)
    const auth = await checkManagerOrDelegate(
      req.user.userId,
      goal.employee_id,
      goal.cycle_id,
      goal.quarter
    );
    
    if (!auth.isAuthorized) {
      return res.status(403).json({ error: 'Not authorized to return this goal' });
    }
    
    const result = await query(
      `UPDATE goals SET status = 'returned', manager_comments = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [comments || null, req.params.id]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/goals/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM goals WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    res.json({ message: 'Goal deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/goals/:id/revoke - Revoke (delete) approved goal/KPI
router.post('/:id/revoke', authMiddleware, async (req, res) => {
  try {
    // Get goal details including employee_id, cycle_id, quarter, and status
    const goalResult = await query(
      'SELECT employee_id, cycle_id, quarter, status FROM goals WHERE id = $1',
      [req.params.id]
    );
    
    if (goalResult.rows.length === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    
    const goal = goalResult.rows[0];
    
    // Only allow revoking approved goals
    if (goal.status !== 'approved') {
      return res.status(400).json({ error: 'Only approved goals can be revoked' });
    }
    
    // Check if user is manager or delegate
    const auth = await checkManagerOrDelegate(
      req.user.userId,
      goal.employee_id,
      goal.cycle_id,
      goal.quarter
    );
    
    if (!auth.isAuthorized) {
      return res.status(403).json({ error: 'Not authorized to revoke this goal' });
    }
    
    // Delete the goal
    const result = await query(
      'DELETE FROM goals WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    
    res.json({ message: 'Approved goal revoked and deleted successfully' });
  } catch (error) {
    console.error('Revoke goal error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== GOAL SELF RATINGS ==========

// GET /api/goals/self-ratings
router.get('/self-ratings', authMiddleware, async (req, res) => {
  try {
    const { self_evaluation_id, goal_id } = req.query;
    
    let sql = 'SELECT * FROM goal_self_ratings WHERE 1=1';
    const params = [];
    let idx = 1;

    if (self_evaluation_id) {
      sql += ` AND self_evaluation_id = $${idx++}`;
      params.push(self_evaluation_id);
    }
    if (goal_id) {
      sql += ` AND goal_id = $${idx++}`;
      params.push(goal_id);
    }

    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/goals/self-ratings
router.post('/self-ratings', authMiddleware, async (req, res) => {
  try {
    const { self_evaluation_id, goal_id, self_rating, achievement, evidence } = req.body;
    
    const result = await query(
      `INSERT INTO goal_self_ratings (id, self_evaluation_id, goal_id, self_rating, achievement, evidence, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (self_evaluation_id, goal_id) DO UPDATE SET
         self_rating = EXCLUDED.self_rating,
         achievement = EXCLUDED.achievement,
         evidence = EXCLUDED.evidence,
         updated_at = NOW()
       RETURNING *`,
      [self_evaluation_id, goal_id, self_rating, achievement, evidence]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== GOAL MANAGER RATINGS ==========

// GET /api/goals/manager-ratings
router.get('/manager-ratings', authMiddleware, async (req, res) => {
  try {
    const { manager_evaluation_id, goal_id } = req.query;
    
    let sql = 'SELECT * FROM goal_manager_ratings WHERE 1=1';
    const params = [];
    let idx = 1;

    if (manager_evaluation_id) {
      sql += ` AND manager_evaluation_id = $${idx++}`;
      params.push(manager_evaluation_id);
    }
    if (goal_id) {
      sql += ` AND goal_id = $${idx++}`;
      params.push(goal_id);
    }

    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/goals/manager-ratings
router.post('/manager-ratings', authMiddleware, async (req, res) => {
  try {
    const { manager_evaluation_id, goal_id, rating, comments } = req.body;
    
    const result = await query(
      `INSERT INTO goal_manager_ratings (id, manager_evaluation_id, goal_id, rating, comments, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (manager_evaluation_id, goal_id) DO UPDATE SET
         rating = EXCLUDED.rating,
         comments = EXCLUDED.comments,
         updated_at = NOW()
       RETURNING *`,
      [manager_evaluation_id, goal_id, rating, comments]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

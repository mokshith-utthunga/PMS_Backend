import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware, requireRole, hasAnyRole } from '../middleware/auth.js';
import { checkManagerOrDelegate } from './delegations.js';
import { hasActiveTransition, canPerformTransitionActions, getManagerRoleForTransition } from '../services/transitionService.js';

const router = express.Router();

// GET /api/kras - Get KRAs with filters
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, status, quarter, period_type, transition_id } = req.query;
    
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
    
    let sql = 'SELECT * FROM kras WHERE 1=1';
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
    if (quarter) {
      sql += ` AND quarter = $${idx++}`;
      params.push(parseInt(quarter));
    }
    if (period_type) {
      sql += ` AND period_type = $${idx++}::period_type`;
      params.push(period_type);
    }
    // Apply transition_id filtering only for manager views (not for employee viewing own goals)
    // When a manager views another employee's goals, we need to filter by transition_id
    // When an employee views their own goals, they should see all their goals (pre + post + full_quarter)
    const isManagerViewingOtherEmployee = managerId && employee_id && cycle_id && employee_id !== managerId;
    
    if (transition_id) {
      sql += ` AND transition_id = $${idx++}`;
      params.push(transition_id);
    } else if (isManagerViewingOtherEmployee && !period_type) {
      // When transition_id is not provided AND it's a manager viewing another employee AND period_type is not specified,
      // only return KRAs where transition_id IS NULL
      // This ensures we only get pre-transition and full_quarter KRAs (not post-transition)
      // However, if period_type is specified (e.g., 'pre_transition'), we should not filter by transition_id IS NULL
      // because pre-transition KRAs have a transition_id set
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
          // Old manager: only pre-transition and full_quarter KRAs (NOT post-transition)
          // Old manager should NOT see new goals (post-transition KRAs)
          sql += ` AND (period_type IS NULL OR period_type = 'full_quarter'::period_type OR period_type = 'pre_transition'::period_type)`;
        } else if (managerRole === 'new_manager') {
          // New manager: only post-transition KRAs
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
            // Manager is only old manager (different managers): only pre-transition and full_quarter KRAs (NOT post-transition)
            // Old manager should NOT see new goals (post-transition KRAs)
            sql += ` AND (period_type IS NULL OR period_type = 'full_quarter'::period_type OR period_type = 'pre_transition'::period_type)`;
          } else if (isNewManager && !isOldManager) {
            // Manager is only new manager (different managers): only post-transition KRAs
            sql += ` AND (period_type IS NULL OR period_type = 'full_quarter'::period_type OR period_type = 'post_transition'::period_type)`;
          }
          // If manager is both old and new (same_manager) or neither, show all data
        }
      }
    }

    sql += ' ORDER BY created_at ASC';
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/kras/my - Get current user's KRAs
router.get('/my', authMiddleware, async (req, res) => {
  try {
    const { cycle_id, quarter } = req.query;
    
    const empResult = await query(
      'SELECT id FROM employees WHERE profile_id = $1',
      [req.user.userId]
    );
    
    if (empResult.rows.length === 0) {
      return res.json({ data: [] });
    }
    
    let sql = 'SELECT * FROM kras WHERE employee_id = $1';
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
    sql += ' ORDER BY created_at ASC';
    
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/kras
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { employee_id, cycle_id, title, description, weight, status, quarter, kra_template_id, period_type, transition_id } = req.body;
    
    // Auto-detect transition if not explicitly provided
    let periodType = period_type || null;
    let transitionId = transition_id || null;
    let periodStartDate = null;
    let periodEndDate = null;
    let hasActiveTransitionFlag = false;

    if (employee_id && cycle_id && quarter && !periodType && !transitionId) {
      // Check if there's an active transition for this employee/cycle/quarter
      hasActiveTransitionFlag = await hasActiveTransition(employee_id, cycle_id, quarter);
      
      if (hasActiveTransitionFlag) {
        const transitionResult = await query(
          `SELECT id, transition_date
           FROM employee_quarter_transitions 
           WHERE employee_id = $1 AND cycle_id = $2 AND quarter = $3`,
          [employee_id, cycle_id, quarter]
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
            
            if (now >= transitionDate) {
              // KRA is being created after transition, mark as post_transition
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
              // KRA is being created before transition, mark as pre_transition
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
    } else if (transition_id || period_type) {
      hasActiveTransitionFlag = true;
    }
    
    const result = await query(
      `INSERT INTO kras (id, employee_id, cycle_id, kra_template_id, title, description, weight, status, quarter, period_type, transition_id, period_start_date, period_end_date, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9::period_type, $10, $11, $12, NOW(), NOW())
       RETURNING *`,
      [
        employee_id, 
        cycle_id, 
        kra_template_id || null, 
        title, 
        description, 
        weight, 
        status || 'draft', 
        quarter || null,
        periodType,
        transitionId,
        periodStartDate,
        periodEndDate
      ]
    );
    
    // Return response with transition info for frontend date validation bypass
    const responseData = result.rows[0];
    if (hasActiveTransitionFlag || transitionId) {
      // For transition employees: NO validation needed - they can set goals at any time
      // The only requirement is that a transition exists for this employee/cycle/quarter
      responseData.has_active_transition = true;
      responseData.date_validation_bypassed = true;
    }
    
    res.status(201).json({ data: responseData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/kras/:id
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { title, description, weight, status, quarter, manager_comments } = req.body;
    
    // Parse and validate quarter if provided
    let parsedQuarter = null;
    if (quarter !== undefined && quarter !== null) {
      // Check if quarter is a valid integer (not a UUID)
      const quarterNum = typeof quarter === 'string' ? parseInt(quarter, 10) : quarter;
      if (isNaN(quarterNum) || quarterNum < 1 || quarterNum > 4) {
        return res.status(400).json({ error: 'Quarter must be a number between 1 and 4' });
      }
      parsedQuarter = quarterNum;
    }
    
    // Get current KRA details including period_type and transition_id for authorization
    const currentKraResult = await query(
      'SELECT employee_id, cycle_id, quarter, period_type, transition_id FROM kras WHERE id = $1',
      [req.params.id]
    );
    
    if (currentKraResult.rows.length === 0) {
      return res.status(404).json({ error: 'KRA not found' });
    }
    
    const currentKra = currentKraResult.rows[0];
    
    // Check authorization for any update (not just approvals)
    // This is especially important for transition employees where new manager should be able to update post-transition KRAs
    if (currentKra.employee_id && currentKra.cycle_id && currentKra.quarter) {
      // Get current user's employee ID
      const currentUserResult = await query(
        'SELECT id FROM employees WHERE profile_id = $1',
        [req.user.userId]
      );
      
      if (currentUserResult.rows.length > 0) {
        const currentUserId = currentUserResult.rows[0].id;
        
        // For transition KRAs, verify the correct manager can update/approve
        if (currentKra.period_type && currentKra.period_type !== 'full_quarter' && currentKra.transition_id) {
          try {
            const transitionResult = await query(
              'SELECT old_manager_id, new_manager_id FROM employee_quarter_transitions WHERE id = $1',
              [currentKra.transition_id]
            );
            
            if (transitionResult.rows.length > 0) {
              const transition = transitionResult.rows[0];
              
              // For pre-transition KRAs, only old manager can update/approve
              if (currentKra.period_type === 'pre_transition') {
                if (transition.old_manager_id && currentUserId !== transition.old_manager_id) {
                  const errorMsg = status === 'approved' 
                    ? 'Only the pre-transition manager can approve pre-transition KRAs'
                    : 'Only the pre-transition manager can update pre-transition KRAs';
                  return res.status(403).json({ error: errorMsg });
                }
              }
              // For post-transition KRAs, only new manager can update/approve (if managers are different)
              // Note: If new_manager_id is null/empty, it is considered as the same manager
              else if (currentKra.period_type === 'post_transition') {
                // If new_manager_id is null/empty, it's the same manager, so old_manager can update/approve
                if (transition.new_manager_id && transition.new_manager_id !== transition.old_manager_id) {
                  // Different managers - only new manager can update/approve post-transition
                  if (currentUserId !== transition.new_manager_id) {
                    const errorMsg = status === 'approved'
                      ? 'Only the post-transition manager can approve post-transition KRAs'
                      : 'Only the post-transition manager can update post-transition KRAs';
                    return res.status(403).json({ error: errorMsg });
                  }
                } else {
                  // Same manager (new_manager_id is null or equals old_manager_id) - old_manager can update/approve
                  if (transition.old_manager_id && currentUserId !== transition.old_manager_id) {
                    const errorMsg = status === 'approved'
                      ? 'Only the manager can approve post-transition KRAs'
                      : 'Only the manager can update post-transition KRAs';
                    return res.status(403).json({ error: errorMsg });
                  }
                }
              }
            }
          } catch (transitionError) {
            // If transition check fails, log but don't block - let checkManagerOrDelegate handle it
            console.error('Error checking transition authorization:', transitionError);
          }
        }
        
        // Check if user is HR/Admin - they can update any KRA
        const isHRAdmin = await hasAnyRole(req.user.userId, ['hr_admin', 'system_admin']);
        
        // If not HR/Admin, check if user is manager or delegate (includes transition checks)
        if (!isHRAdmin) {
          const auth = await checkManagerOrDelegate(
            req.user.userId,
            currentKra.employee_id,
            currentKra.cycle_id,
            currentKra.quarter
          );
          
          if (!auth.isAuthorized) {
            const errorMessage = status === 'approved' 
              ? 'Not authorized to approve this KRA' 
              : 'Not authorized to update this KRA';
            return res.status(403).json({ error: errorMessage });
          }
        }
      }
    }
    
    const result = await query(
      `UPDATE kras SET
        title = COALESCE($1, title),
        description = $2,
        weight = COALESCE($3, weight),
        status = COALESCE($4, status),
        quarter = COALESCE($5, quarter),
        manager_comments = COALESCE($6, manager_comments),
        updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [
        title ?? null,
        description ?? null,
        weight ?? null,
        status ?? null,
        parsedQuarter,
        manager_comments ?? null,
        req.params.id
      ]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'KRA not found' });
    }
    res.json({ data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/kras/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    // First check if KRA exists
    const checkResult = await query(
      'SELECT id, employee_id, cycle_id, quarter, status FROM kras WHERE id = $1',
      [id]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'KRA not found' });
    }
    
    const kra = checkResult.rows[0];
    
    // Delete the KRA (this will cascade delete associated KPIs due to ON DELETE CASCADE)
    const result = await query(
      'DELETE FROM kras WHERE id = $1 RETURNING id',
      [id]
    );
    
    if (result.rows.length === 0) {
      // This shouldn't happen if checkResult found it, but handle it anyway
      return res.status(404).json({ error: 'KRA not found or could not be deleted' });
    }
    
    res.json({ message: 'KRA deleted successfully' });
  } catch (error) {
    console.error('Delete KRA error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/kras/:id/revoke - Revoke (delete) approved KRA
router.post('/:id/revoke', authMiddleware, async (req, res) => {
  try {
    // Get KRA details including employee_id, cycle_id, quarter, and status
    const kraResult = await query(
      'SELECT employee_id, cycle_id, quarter, status FROM kras WHERE id = $1',
      [req.params.id]
    );
    
    if (kraResult.rows.length === 0) {
      return res.status(404).json({ error: 'KRA not found' });
    }
    
    const kra = kraResult.rows[0];
    
    // Only allow revoking approved KRAs
    if (kra.status !== 'approved') {
      return res.status(400).json({ error: 'Only approved KRAs can be revoked' });
    }
    
    // Check if user is manager or delegate
    const auth = await checkManagerOrDelegate(
      req.user.userId,
      kra.employee_id,
      kra.cycle_id,
      kra.quarter
    );
    
    if (!auth.isAuthorized) {
      return res.status(403).json({ error: 'Not authorized to revoke this KRA' });
    }
    
    // Delete the KRA (this will cascade delete associated KPIs due to ON DELETE CASCADE)
    const result = await query(
      'DELETE FROM kras WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'KRA not found' });
    }
    
    res.json({ message: 'Approved KRA revoked and deleted successfully' });
  } catch (error) {
    console.error('Revoke KRA error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/kras/submit - Submit multiple KRAs
router.post('/submit', authMiddleware, async (req, res) => {
  try {
    const { kra_ids } = req.body;
    
    const result = await query(
      `UPDATE kras SET status = 'submitted', updated_at = NOW() 
       WHERE id = ANY($1) RETURNING *`,
      [kra_ids]
    );
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== KRA TEMPLATES ==========

// GET /api/kras/templates
router.get('/templates', authMiddleware, async (req, res) => {
  try {
    const { department, grade, is_active } = req.query;
    
    let sql = 'SELECT * FROM kra_templates WHERE 1=1';
    const params = [];
    let idx = 1;

    if (department) {
      sql += ` AND (department = $${idx++} OR department IS NULL)`;
      params.push(department);
    }
    if (grade) {
      sql += ` AND (grade = $${idx++} OR grade IS NULL)`;
      params.push(grade);
    }
    if (is_active !== undefined) {
      sql += ` AND is_active = $${idx++}`;
      params.push(is_active === 'true');
    }

    sql += ' ORDER BY title ASC';
    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/kras/templates/:id/kpis
router.get('/templates/:id/kpis', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM kpi_templates WHERE kra_template_id = $1 ORDER BY title ASC',
      [req.params.id]
    );
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/kras/templates/:id/kpi-templates - Delete all KPI templates for a KRA template
router.delete('/templates/:id/kpi-templates', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Verify the KRA template exists
    const kraCheck = await query(
      'SELECT id FROM kra_templates WHERE id = $1',
      [id]
    );
    
    if (kraCheck.rows.length === 0) {
      return res.status(404).json({ error: 'KRA template not found' });
    }
    
    // Delete all KPI templates for this KRA template
    const result = await query(
      'DELETE FROM kpi_templates WHERE kra_template_id = $1',
      [id]
    );
    
    res.json({ 
      success: true, 
      message: `Deleted ${result.rowCount} KPI template(s)` 
    });
  } catch (error) {
    console.error('Delete KPI templates error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/kras/kpi-templates - Get KPI templates by kra_template_id query param
router.get('/kpi-templates', authMiddleware, async (req, res) => {
  try {
    const { kra_template_id } = req.query;
    
    if (!kra_template_id) {
      return res.status(400).json({ error: 'kra_template_id is required' });
    }
    
    const result = await query(
      'SELECT * FROM kpi_templates WHERE kra_template_id = $1 ORDER BY title ASC',
      [kra_template_id]
    );
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/kras/kpi-templates - Create a new KPI template
router.post('/kpi-templates', authMiddleware, async (req, res) => {
  try {
    const { kra_template_id, title, description, metric_type, suggested_target, suggested_weight, target_value, weight, calibration } = req.body;
    
    if (!kra_template_id || !title) {
      return res.status(400).json({ error: 'kra_template_id and title are required' });
    }
    
    // Support both new field names (suggested_target, suggested_weight) and legacy (target_value, weight)
    const target = suggested_target || target_value || null;
    const kpiWeight = suggested_weight || weight || 50;
    
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
    
    const result = await query(
      `INSERT INTO kpi_templates (kra_template_id, title, description, metric_type, suggested_target, suggested_weight, calibration)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [kra_template_id, title, description || null, metric_type || 'number', target, kpiWeight, calibrationJson]
    );
    
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    console.error('Create KPI template error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/kras/kpi-templates/:id - Update an existing KPI template
router.put('/kpi-templates/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, metric_type, suggested_target, suggested_weight, target_value, weight, calibration } = req.body;
    
    // Support both new field names (suggested_target, suggested_weight) and legacy (target_value, weight)
    const target = suggested_target !== undefined ? suggested_target : (target_value !== undefined ? target_value : null);
    const kpiWeight = suggested_weight !== undefined ? suggested_weight : (weight !== undefined ? weight : undefined);
    
    // Validate and format calibration if provided
    let calibrationJson = undefined;
    if (calibration !== undefined) {
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
    
    if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(title);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description || null);
    }
    if (metric_type !== undefined) {
      updates.push(`metric_type = $${paramIndex++}`);
      values.push(metric_type);
    }
    if (target !== undefined) {
      updates.push(`suggested_target = $${paramIndex++}`);
      values.push(target);
    }
    if (kpiWeight !== undefined) {
      updates.push(`suggested_weight = $${paramIndex++}`);
      values.push(kpiWeight);
    }
    if (calibrationJson !== undefined) {
      updates.push(`calibration = $${paramIndex++}`);
      values.push(calibrationJson);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    updates.push(`updated_at = NOW()`);
    values.push(id);
    
    const result = await query(
      `UPDATE kpi_templates 
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'KPI template not found' });
    }
    
    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Update KPI template error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/kpi-templates/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query(
      'DELETE FROM kpi_templates WHERE id = $1 RETURNING id',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'KPI template not found' });
    }
    
    res.json({ success: true, message: 'KPI template deleted successfully' });
  } catch (error) {
    console.error('Delete KPI template error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== LATE SUBMISSION PERMISSIONS ==========

// GET /api/kras/late-permissions
// Restricted to HR Admin and System Admin
router.get('/late-permissions', authMiddleware, requireRole(['hr_admin', 'system_admin']), async (req, res) => {
  try {
    const { employee_id, cycle_id } = req.query;
    
    let sql = 'SELECT * FROM late_submission_permissions WHERE revoked_at IS NULL';
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

    const result = await query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

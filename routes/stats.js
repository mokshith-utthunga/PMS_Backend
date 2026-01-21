import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// GET /api/stats/admin-dashboard - Admin dashboard statistics
router.get('/admin-dashboard', authMiddleware, async (req, res) => {
  try {
    const [employees, cycles, departments, grades] = await Promise.all([
      query('SELECT COUNT(*) FROM employees'),
      query("SELECT COUNT(*) FROM performance_cycles WHERE status = 'active'"),
      query('SELECT COUNT(*) FROM departments'),
      query('SELECT COUNT(*) FROM grades')
    ]);

    res.json({
      data: {
        totalEmployees: parseInt(employees.rows[0].count) || 0,
        activeCycles: parseInt(cycles.rows[0].count) || 0,
        departments: parseInt(departments.rows[0].count) || 0,
        grades: parseInt(grades.rows[0].count) || 0
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/stats/hr-dashboard - HR dashboard statistics
router.get('/hr-dashboard', authMiddleware, async (req, res) => {
  try {
    const [employees, cycles, calibrations, departments] = await Promise.all([
      query('SELECT COUNT(*) FROM employees'),
      query("SELECT COUNT(*) FROM performance_cycles WHERE status = 'active'"),
      query("SELECT COUNT(*) FROM calibration_groups WHERE status = 'draft'"),
      query('SELECT COUNT(*) FROM departments')
    ]);

    res.json({
      totalEmployees: parseInt(employees.rows[0].count) || 0,
      activeCycles: parseInt(cycles.rows[0].count) || 0,
      pendingCalibrations: parseInt(calibrations.rows[0].count) || 0,
      departments: parseInt(departments.rows[0].count) || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/stats/manager-dashboard - Manager dashboard statistics
router.get('/manager-dashboard', authMiddleware, async (req, res) => {
  try {
    // Get manager's employee record (need both id and emp_code)
    const empResult = await query(
      'SELECT id, emp_code FROM employees WHERE profile_id = $1',
      [req.user.userId]
    );
    
    if (empResult.rows.length === 0) {
      return res.json({ teamCount: 0, pendingApprovals: 0, completedEvals: 0 });
    }
    
    const managerId = empResult.rows[0].id;
    const managerCode = empResult.rows[0].emp_code;
    
    const [team, pending, completed] = await Promise.all([
      query('SELECT COUNT(*) FROM employees WHERE manager_code = $1', [managerCode]),
      query(`
        SELECT COUNT(*) FROM goals g
        JOIN employees e ON g.employee_id = e.id
        WHERE e.manager_code = $1 AND g.status = 'submitted'
      `, [managerCode]),
      query(`
        SELECT COUNT(*) FROM manager_evaluations 
        WHERE evaluator_id = $1 AND status = 'submitted'
      `, [managerId])
    ]);

    res.json({
      teamCount: parseInt(team.rows[0].count) || 0,
      pendingApprovals: parseInt(pending.rows[0].count) || 0,
      completedEvals: parseInt(completed.rows[0].count) || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

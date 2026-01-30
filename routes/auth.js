import express from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database.js';
import { generateToken, authMiddleware, optionalAuthMiddleware, setAuthCookies, clearAuthCookies } from '../middleware/auth.js';
import { syncEmployeeDataFromUserMaster } from '../services/userMasterApi.js';

const router = express.Router();

// Sign up - POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { email, password, full_name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Check if user already exists
    const existingUser = await query(
      'SELECT id FROM profiles WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists with this email' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create user profile
    const userId = uuidv4();
    await query(
      `INSERT INTO profiles (id, email, password_hash, full_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [userId, email, passwordHash, full_name || null]
    );

    // Assign default employee role (now stored in profiles table)
    await query(
      `UPDATE profiles SET role = 'employee'::app_role WHERE id = $1`,
      [userId]
    );

    // Generate token and set cookies
    const token = generateToken(userId, email);
    const user = { id: userId, email, full_name: full_name || null };
    setAuthCookies(res, token, user);

    res.status(201).json({
      user,
      session: { access_token: token }
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// Login - POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

   

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const result = await query(
      'SELECT id, email, password_hash, full_name FROM profiles WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    try {
      // Try to get employee_code from employees table
      const empResult = await query(
        'SELECT emp_code FROM employees WHERE profile_id = $1 OR email = $2 LIMIT 1',
        [user.id, user.email]
      );
      
      const employeeCode = empResult.rows.length > 0 ? empResult.rows[0].emp_code : null;
      
      console.log(`[Auth] Attempting to sync employee data for profileId: ${user.id}, email: ${user.email}, employeeCode: ${employeeCode || 'not found'}`);
      
      // Sync using employee_code if available, otherwise use email
      const syncResult = await syncEmployeeDataFromUserMaster(user.id, user.email, employeeCode);
      console.log(`[Auth] Sync result: ${syncResult}`);
    } catch (syncError) {
      // Log error but don't fail login if sync fails
      console.error('[Auth] Error syncing employee data from User Master:', syncError);
      console.error('[Auth] Error stack:', syncError.stack);
    }

    // Generate token and set cookies
    const token = generateToken(user.id, user.email);
    setAuthCookies(res, token, { id: user.id, email: user.email, full_name: user.full_name });

    res.json({
      user: { id: user.id, email: user.email, full_name: user.full_name },
      session: { access_token: token }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// Get current session - GET /api/auth/session
router.get('/session', optionalAuthMiddleware, async (req, res) => {
  try {
    // If no user from middleware, return null user (not logged in)
    if (!req.user) {
      return res.json({ user: null, session: null });
    }

    const result = await query(
      'SELECT id, email, full_name, created_at, updated_at FROM profiles WHERE id = $1',
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      clearAuthCookies(res);
      return res.json({ user: null, session: null });
    }

    const user = result.rows[0];
    
    // Get token from cookie or header
    const token = req.cookies?.pms_token || req.headers.authorization?.split(' ')[1];
    
    res.json({
      user: { id: user.id, email: user.email, full_name: user.full_name },
      session: { access_token: token }
    });
  } catch (error) {
    console.error('Session error:', error);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

// Logout - POST /api/auth/logout
router.post('/logout', (req, res) => {
  clearAuthCookies(res);
  res.json({ message: 'Logged out successfully' });
});

// Get user roles - GET /api/auth/roles
router.get('/roles', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      'SELECT role FROM profiles WHERE id = $1',
      [req.user.userId]
    );

    // Return as array for backward compatibility
    res.json({ roles: result.rows.length > 0 && result.rows[0].role ? [result.rows[0].role] : [] });
  } catch (error) {
    console.error('Roles error:', error);
    res.status(500).json({ error: 'Failed to get roles' });
  }
});

// Reset password - POST /api/auth/reset-password (for admin/debugging)
// This endpoint allows resetting a user's password - useful for testing
router.post('/reset-password', async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
      return res.status(400).json({ error: 'Email and new password are required' });
    }

    // Find user (case-insensitive)
    const result = await query(
      'SELECT id, email FROM profiles WHERE LOWER(email) = LOWER($1)',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    // Update password
    await query(
      'UPDATE profiles SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [passwordHash, user.id]
    );

    console.log(`[Auth] Password reset for user: ${email}`);
    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

export default router;

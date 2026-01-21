import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { query } from '../config/database.js';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'pms-jwt-secret-key-change-in-production-2026';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Cookie configuration
export const COOKIE_CONFIG = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/'
};

export const generateToken = (userId, email) => {
  return jwt.sign(
    { userId, email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
};

export const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};

// Helper to extract token from request (cookie first, then Authorization header)
const extractToken = (req) => {
  // First check for token in cookies
  if (req.cookies && req.cookies.pms_token) {
    return req.cookies.pms_token;
  }

  // Fall back to Authorization header for backwards compatibility
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }

  return null;
};

export const authMiddleware = (req, res, next) => {
  const token = extractToken(req);
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const decoded = verifyToken(token);

  if (!decoded) {
    // Clear invalid cookie
    res.clearCookie('pms_token', { path: '/' });
    res.clearCookie('pms_user', { path: '/' });
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = decoded;
  next();
};

export const optionalAuthMiddleware = (req, res, next) => {
  const token = extractToken(req);
  
  if (token) {
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
    }
  }
  
  next();
};

// Helper to set auth cookies
export const setAuthCookies = (res, token, user) => {
  res.cookie('pms_token', token, COOKIE_CONFIG);
  res.cookie('pms_user', JSON.stringify({ id: user.id, email: user.email }), {
    ...COOKIE_CONFIG,
    httpOnly: false // Allow JavaScript to read user info
  });
};

// Helper to clear auth cookies
export const clearAuthCookies = (res) => {
  res.clearCookie('pms_token', { path: '/' });
  res.clearCookie('pms_user', { path: '/' });
};

// Helper to check if user has any of the required roles
export const hasAnyRole = async (userId, requiredRoles) => {
  try {
    const result = await query(
      'SELECT role FROM profiles WHERE id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return false;
    }
    
    const userRole = result.rows[0].role;
    return requiredRoles.includes(userRole);
  } catch (error) {
    console.error('Role check error:', error);
    return false;
  }
};

// Middleware to check if user has any of the required roles
export const requireRole = (requiredRoles) => {
  return async (req, res, next) => {
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const hasRole = await hasAnyRole(req.user.userId, requiredRoles);
    
    if (!hasRole) {
      return res.status(403).json({ error: 'Access denied. Insufficient permissions.' });
    }
    
    next();
  };
};
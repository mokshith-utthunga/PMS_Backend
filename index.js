import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { testConnection } from './config/database.js';
import authRoutes from './routes/auth.js';
import apiRoutes from './routes/api.js';
import ssoRoutes from './routes/sso.js';
import employeeRoutes from './routes/employees.js';
import cycleRoutes from './routes/cycles.js';
import goalRoutes from './routes/goals.js';
import evaluationRoutes from './routes/evaluations.js';
import statsRoutes from './routes/stats.js';
import krasRoutes from './routes/kras.js';
import settingsRoutes from './routes/settings.js';
import dataRoutes from './routes/data.js';
import notificationRoutes from './routes/notifications.js';
import bonusKrasRoutes from './routes/bonus-kras.js';
import permissionsRoutes from './routes/permissions.js';
import templatesRoutes from './routes/templates.js';
import calibrationRoutes from './routes/calibration.js';

// Load environment variables
dotenv.config();

// Test database connection
testConnection();

const app = express();
const PORT = process.env.PORT || 3001;

// Cookie configuration
const COOKIE_CONFIG = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/'
};

// Export cookie config for use in routes
export { COOKIE_CONFIG };

// Middleware
app.use(cors({
  origin: [
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://localhost:5173',
    'http://127.0.0.1:5173'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
  exposedHeaders: ['Set-Cookie']
}));

app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging in development
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// REST API routes - All backend routes under /api
app.use('/api/auth', authRoutes);
app.use('/api/external-auth', ssoRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/cycles', cycleRoutes);
app.use('/api/goals', goalRoutes);
app.use('/api/evaluations', evaluationRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/kras', krasRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/bonus-kras', bonusKrasRoutes);
app.use('/api/permissions', permissionsRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/calibration', calibrationRoutes);

// Generic API (fallback for complex queries)
app.use('/api', apiRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV !== 'production' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`PMS Backend Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`CORS enabled for: http://localhost:8080`);
});

export default app;

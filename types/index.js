// Database Types & Enums
// These match the PostgreSQL schema in pmsDBSchema.sql

export const AppRole = {
  EMPLOYEE: 'employee',
  MANAGER: 'manager',
  DEPT_HEAD: 'dept_head',
  HR_ADMIN: 'hr_admin',
  HRBP: 'hrbp',
  SYSTEM_ADMIN: 'system_admin'
};

export const CycleStatus = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  CLOSED: 'closed',
  ARCHIVED: 'archived'
};

export const EmployeeStatus = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  ON_LEAVE: 'on_leave',
  TERMINATED: 'terminated'
};

export const GoalStatus = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  RETURNED: 'returned',
  LOCKED: 'locked'
};

export const GoalType = {
  KPI: 'kpi',
  OKR: 'okr',
  COMPETENCY: 'competency'
};

export const MetricType = {
  NUMBER: 'number',
  PERCENTAGE: 'percentage',
  MILESTONE: 'milestone',
  QUALITATIVE: 'qualitative'
};

export const EvaluationStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  SUBMITTED: 'submitted',
  CALIBRATED: 'calibrated',
  RELEASED: 'released'
};

export const NotificationType = {
  GOAL_APPROVAL: 'goal_approval',
  GOAL_RETURNED: 'goal_returned',
  EVALUATION_PENDING: 'evaluation_pending',
  CALIBRATION_PENDING: 'calibration_pending',
  RESULTS_RELEASED: 'results_released',
  GENERAL: 'general'
};

// Valid tables for API access
export const VALID_TABLES = [
  'profiles',
  'user_roles',
  'employees',
  'manager_history',
  'performance_cycles',
  'rating_scales',
  'competencies',
  'kras',
  'goals',
  'goal_attachments',
  'bonus_kras',
  'bonus_kpis',
  'self_evaluations',
  'goal_self_ratings',
  'competency_self_ratings',
  'manager_evaluations',
  'goal_manager_ratings',
  'bonus_kra_ratings',
  'quarterly_self_reviews',
  'quarterly_kpi_progress',
  'quarterly_manager_reviews',
  'quarterly_kpi_manager_feedback',
  'calibration_groups',
  'quota_rules',
  'calibration_entries',
  'calibration_settings',
  'default_calibration_quotas',
  'department_calibration_quotas',
  'late_submission_permissions',
  'kra_templates',
  'kpi_templates',
  'audit_logs',
  'notifications',
  'departments',
  'business_units',
  'grades',
  'locations'
];

export default {
  AppRole,
  CycleStatus,
  EmployeeStatus,
  GoalStatus,
  GoalType,
  MetricType,
  EvaluationStatus,
  NotificationType,
  VALID_TABLES
};

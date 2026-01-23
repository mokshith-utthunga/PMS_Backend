-- PMS Database Schema for PostgreSQL
-- Run this script to create all tables
-- Database: PMS
-- User: postgress
-- Password: Mokshith@001$#

-- Create ENUM types
DO $$ BEGIN
    CREATE TYPE app_role AS ENUM (
        'employee',
        'manager',
        'dept_head',
        'hr_admin',
        'hrbp',
        'system_admin'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE employee_status AS ENUM ('active', 'inactive', 'on_leave', 'terminated');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE goal_status AS ENUM (
        'draft',
        'submitted',
        'approved',
        'returned',
        'locked'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE goal_type AS ENUM ('kpi', 'okr', 'competency');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE metric_type AS ENUM (
        'number',
        'percentage',
        'milestone',
        'qualitative'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE evaluation_status AS ENUM (
        'pending',
        'in_progress',
        'submitted',
        'calibrated',
        'released'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE cycle_status AS ENUM ('draft', 'active', 'closed', 'archived');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE notification_type AS ENUM (
        'goal_approval',
        'goal_returned',
        'evaluation_pending',
        'calibration_pending',
        'results_released',
        'general'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 1. profiles (linked to users - replaces auth.users)
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT,
    role app_role NOT NULL DEFAULT 'employee'::app_role,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. employees
CREATE TABLE IF NOT EXISTS employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    emp_code TEXT UNIQUE NOT NULL,
    profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    manager_code VARCHAR(255) REFERENCES employees(emp_code) ON DELETE SET NULL,
    department TEXT NOT NULL,
    business_unit TEXT NOT NULL,
    grade TEXT NOT NULL,
    location TEXT NOT NULL,
    sub_department TEXT,
    status employee_status NOT NULL DEFAULT 'active',
    date_of_joining DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. manager_history
CREATE TABLE IF NOT EXISTS manager_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    old_manager_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    new_manager_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    effective_date DATE NOT NULL,
    changed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. performance_cycles
CREATE TABLE IF NOT EXISTS performance_cycles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    status cycle_status NOT NULL DEFAULT 'draft',
    year INTEGER NOT NULL,
    goal_submission_start DATE NOT NULL,
    goal_submission_end DATE NOT NULL,
    goal_approval_end DATE NOT NULL,
    self_evaluation_start DATE,
    self_evaluation_end DATE,
    manager_evaluation_start DATE NOT NULL,
    manager_evaluation_end DATE NOT NULL,
    calibration_start DATE NOT NULL,
    calibration_end DATE NOT NULL,
    release_date DATE NOT NULL,
    -- Quarterly review dates
    q1_self_review_start DATE,
    q1_self_review_end DATE,
    q1_manager_review_start DATE,
    q1_manager_review_end DATE,
    q2_self_review_start DATE,
    q2_self_review_end DATE,
    q2_manager_review_start DATE,
    q2_manager_review_end DATE,
    q3_self_review_start DATE,
    q3_self_review_end DATE,
    q3_manager_review_start DATE,
    q3_manager_review_end DATE,
    q4_self_review_start DATE,
    q4_self_review_end DATE,
    q4_manager_review_start DATE,
    q4_manager_review_end DATE,
    -- Allow late goal submission
    allow_late_goal_submission BOOLEAN NOT NULL DEFAULT false,
    -- Applicable departments
    applicable_departments TEXT[] DEFAULT NULL,
    -- Applicable business units
    applicable_business_units TEXT[] DEFAULT NULL,
    -- Created by
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. rating_scales
CREATE TABLE IF NOT EXISTS rating_scales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    value INTEGER NOT NULL,
    description TEXT,
    color TEXT,
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert default rating scales
INSERT INTO rating_scales (name, value, description, color, is_default)
SELECT * FROM (VALUES
    ('Exceptional', 5, 'Consistently exceeds all expectations and delivers outstanding results', '#22c55e', true),
    ('Exceeds Expectations', 4, 'Frequently exceeds expectations and delivers strong results', '#84cc16', true),
    ('Meets Expectations', 3, 'Consistently meets expectations and delivers solid results', '#eab308', true),
    ('Needs Improvement', 2, 'Sometimes falls short of expectations, requires development', '#f97316', true),
    ('Unsatisfactory', 1, 'Consistently fails to meet expectations', '#ef4444', true)
) AS v(name, value, description, color, is_default)
WHERE NOT EXISTS (SELECT 1 FROM rating_scales);

-- 7. competencies
CREATE TABLE IF NOT EXISTS competencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. kras
CREATE TABLE IF NOT EXISTS kras (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    cycle_id UUID NOT NULL REFERENCES performance_cycles(id) ON DELETE CASCADE,
    kra_template_id UUID REFERENCES kra_templates(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    weight NUMERIC NOT NULL CHECK (weight > 0 AND weight <= 100),
    status goal_status NOT NULL DEFAULT 'draft',
    manager_comments TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. goals
CREATE TABLE IF NOT EXISTS goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    cycle_id UUID NOT NULL REFERENCES performance_cycles(id) ON DELETE CASCADE,
    kra_id UUID REFERENCES kras(id) ON DELETE CASCADE,
    kpi_template_id UUID REFERENCES kpi_templates(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    goal_type goal_type NOT NULL,
    metric_type metric_type NOT NULL,
    target_value TEXT,
    weight DECIMAL(5, 2) NOT NULL CHECK (weight > 0 AND weight <= 100),
    calibration JSONB DEFAULT NULL,
    due_date DATE,
    status goal_status NOT NULL DEFAULT 'draft',
    manager_comments TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10. goal_attachments
CREATE TABLE IF NOT EXISTS goal_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_type TEXT,
    uploaded_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 11. bonus_kras
CREATE TABLE IF NOT EXISTS bonus_kras (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id),
    cycle_id UUID NOT NULL REFERENCES performance_cycles(id),
    title TEXT NOT NULL,
    description TEXT,
    status goal_status NOT NULL DEFAULT 'draft',
    manager_comments TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 12. bonus_kpis
CREATE TABLE IF NOT EXISTS bonus_kpis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bonus_kra_id UUID NOT NULL REFERENCES bonus_kras(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    metric_type metric_type NOT NULL DEFAULT 'number',
    target_value TEXT,
    due_date DATE,
    status goal_status NOT NULL DEFAULT 'draft',
    manager_comments TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 13. self_evaluations
CREATE TABLE IF NOT EXISTS self_evaluations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    cycle_id UUID NOT NULL REFERENCES performance_cycles(id) ON DELETE CASCADE,
    quarter INTEGER CHECK (quarter >= 1 AND quarter <= 4),
    overall_rating INTEGER CHECK (overall_rating >= 1 AND overall_rating <= 5),
    calculated_overall_rating NUMERIC,
    overall_comments TEXT,
    development_plan TEXT,
    status evaluation_status NOT NULL DEFAULT 'pending',
    submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create unique index for self_evaluations
CREATE UNIQUE INDEX IF NOT EXISTS self_evaluations_employee_cycle_quarter_idx 
ON self_evaluations (employee_id, cycle_id, COALESCE(quarter, 0));

-- 14. goal_self_ratings
CREATE TABLE IF NOT EXISTS goal_self_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quarterly_review_id UUID NOT NULL REFERENCES quarterly_self_reviews(id) ON DELETE CASCADE,
    goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    achievement TEXT,
    self_rating INTEGER CHECK (self_rating >= 1 AND self_rating <= 5),
    evidence TEXT,
    achieved_value NUMERIC,
    target_value NUMERIC,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(quarterly_review_id, goal_id)
);

-- 15. competency_self_ratings
CREATE TABLE IF NOT EXISTS competency_self_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    self_evaluation_id UUID NOT NULL REFERENCES self_evaluations(id) ON DELETE CASCADE,
    competency_id UUID NOT NULL REFERENCES competencies(id) ON DELETE CASCADE,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    comments TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(self_evaluation_id, competency_id)
);

-- 16. manager_evaluations
CREATE TABLE IF NOT EXISTS manager_evaluations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    cycle_id UUID NOT NULL REFERENCES performance_cycles(id) ON DELETE CASCADE,
    evaluator_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    overall_rating INTEGER CHECK (overall_rating >= 1 AND overall_rating <= 5),
    potential_rating INTEGER CHECK (potential_rating >= 1 AND potential_rating <= 3),
    overall_comments TEXT,
    development_recommendations TEXT,
    q1_rating NUMERIC(3, 2),
    q2_rating NUMERIC(3, 2),
    q3_rating NUMERIC(3, 2),
    q4_rating NUMERIC(3, 2),
    calculated_overall_rating NUMERIC(3, 2),
    status evaluation_status NOT NULL DEFAULT 'pending',
    submitted_at TIMESTAMPTZ,
    released_at TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,
    acknowledgment_comments TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(employee_id, cycle_id)
);

-- 17. goal_manager_ratings
CREATE TABLE IF NOT EXISTS goal_manager_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manager_evaluation_id UUID NOT NULL REFERENCES manager_evaluations(id) ON DELETE CASCADE,
    goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    comments TEXT,
    manager_achieved_value NUMERIC,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(manager_evaluation_id, goal_id)
);

-- 18. bonus_kra_ratings
CREATE TABLE IF NOT EXISTS bonus_kra_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bonus_kra_id UUID NOT NULL REFERENCES bonus_kras(id) ON DELETE CASCADE,
    manager_evaluation_id UUID NOT NULL REFERENCES manager_evaluations(id),
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    comments TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(bonus_kra_id, manager_evaluation_id)
);

-- 19. quarterly_self_reviews
CREATE TABLE IF NOT EXISTS quarterly_self_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL,
    cycle_id UUID NOT NULL,
    quarter INTEGER NOT NULL,
    overall_rating INTEGER CHECK (overall_rating >= 1 AND overall_rating <= 5),
    overall_comments TEXT,
    status evaluation_status NOT NULL DEFAULT 'pending',
    submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(employee_id, cycle_id, quarter)
);

-- 20. quarterly_kpi_progress
CREATE TABLE IF NOT EXISTS quarterly_kpi_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quarterly_review_id UUID NOT NULL REFERENCES quarterly_self_reviews(id) ON DELETE CASCADE,
    goal_id UUID NOT NULL,
    progress_percentage INTEGER,
    achievement_to_date TEXT,
    challenges TEXT,
    self_rating INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(quarterly_review_id, goal_id)
);

-- 21. quarterly_manager_reviews
CREATE TABLE IF NOT EXISTS quarterly_manager_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL,
    cycle_id UUID NOT NULL,
    quarter INTEGER NOT NULL,
    reviewer_id UUID NOT NULL,
    overall_comments TEXT,
    guidance TEXT,
    calculated_overall_rating NUMERIC(3, 2),
    status evaluation_status NOT NULL DEFAULT 'pending',
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(employee_id, cycle_id, quarter)
);

-- 22. quarterly_kpi_manager_feedback
CREATE TABLE IF NOT EXISTS quarterly_kpi_manager_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manager_review_id UUID NOT NULL REFERENCES quarterly_manager_reviews(id) ON DELETE CASCADE,
    goal_id UUID NOT NULL,
    rating INTEGER,
    comments TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(manager_review_id, goal_id)
);

-- 23. calibration_groups
CREATE TABLE IF NOT EXISTS calibration_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id UUID NOT NULL REFERENCES performance_cycles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    filters JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'draft',
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 24. quota_rules
CREATE TABLE IF NOT EXISTS quota_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calibration_group_id UUID NOT NULL REFERENCES calibration_groups(id) ON DELETE CASCADE,
    rating_value INTEGER NOT NULL CHECK (rating_value >= 1 AND rating_value <= 5),
    percentage DECIMAL(5, 2) CHECK (percentage >= 0 AND percentage <= 100),
    max_count INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 25. calibration_entries
CREATE TABLE IF NOT EXISTS calibration_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calibration_group_id UUID NOT NULL REFERENCES calibration_groups(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    original_rating INTEGER CHECK (original_rating >= 1 AND original_rating <= 5),
    calibrated_rating INTEGER CHECK (calibrated_rating >= 1 AND calibrated_rating <= 5),
    final_rating INTEGER CHECK (final_rating >= 1 AND final_rating <= 5),
    is_exception BOOLEAN NOT NULL DEFAULT false,
    exception_reason TEXT,
    exception_status TEXT,
    approved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(calibration_group_id, employee_id)
);

-- 26. calibration_settings
CREATE TABLE IF NOT EXISTS calibration_settings (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Insert initial settings
INSERT INTO calibration_settings (is_enabled) 
SELECT true WHERE NOT EXISTS (SELECT 1 FROM calibration_settings);

-- 27. default_calibration_quotas
CREATE TABLE IF NOT EXISTS default_calibration_quotas (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    rating_value INTEGER NOT NULL UNIQUE,
    percentage NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Insert default quotas
INSERT INTO default_calibration_quotas (rating_value, percentage)
SELECT * FROM (VALUES (5, 10), (4, 15), (3, 60), (2, 10), (1, 5)) AS v(rating_value, percentage)
WHERE NOT EXISTS (SELECT 1 FROM default_calibration_quotas);

-- 28. department_calibration_quotas
CREATE TABLE IF NOT EXISTS department_calibration_quotas (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    department TEXT NOT NULL,
    rating_value INTEGER NOT NULL,
    percentage NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(department, rating_value)
);

-- 29. late_submission_permissions
CREATE TABLE IF NOT EXISTS late_submission_permissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id uuid NOT NULL REFERENCES performance_cycles(id) ON DELETE CASCADE,
    employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    granted_by uuid NOT NULL,
    granted_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    reason text,
    revoked_at timestamptz,
    UNIQUE(cycle_id, employee_id)
);

-- 30. kra_templates
CREATE TABLE IF NOT EXISTS kra_templates (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    suggested_weight INTEGER NOT NULL DEFAULT 25,
    department TEXT,
    grade TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 31. kpi_templates
CREATE TABLE IF NOT EXISTS kpi_templates (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    kra_template_id UUID NOT NULL REFERENCES kra_templates(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    metric_type metric_type NOT NULL DEFAULT 'number',
    suggested_target TEXT,
    suggested_weight INTEGER NOT NULL DEFAULT 50,
    calibration JSONB DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 32. audit_logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    table_name TEXT NOT NULL,
    record_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 33. notifications
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type notification_type NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    link TEXT,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 34. Lookup Tables
CREATE TABLE IF NOT EXISTS departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS grades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    level INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_employees_profile_id ON employees(profile_id);
CREATE INDEX IF NOT EXISTS idx_employees_manager_code ON employees(manager_code);
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department);
CREATE INDEX IF NOT EXISTS idx_kras_employee_id ON kras(employee_id);
CREATE INDEX IF NOT EXISTS idx_kras_cycle_id ON kras(cycle_id);
CREATE INDEX IF NOT EXISTS idx_goals_employee_id ON goals(employee_id);
CREATE INDEX IF NOT EXISTS idx_goals_cycle_id ON goals(cycle_id);
CREATE INDEX IF NOT EXISTS idx_goals_kra_id ON goals(kra_id);
CREATE INDEX IF NOT EXISTS idx_self_evaluations_employee_cycle ON self_evaluations(employee_id, cycle_id);
CREATE INDEX IF NOT EXISTS idx_manager_evaluations_employee_cycle ON manager_evaluations(employee_id, cycle_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);

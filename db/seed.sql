-- PMS Database Seed Data
-- Run this script after schema.sql to populate with sample data

-- =====================================================
-- 1. LOOKUP TABLES (Departments, Grades, Locations, Business Units)
-- =====================================================

INSERT INTO departments (name) VALUES
  ('Engineering'),
  ('Human Resources'),
  ('Sales'),
  ('Marketing'),
  ('Finance'),
  ('Operations'),
  ('Product Management'),
  ('Quality Assurance')
ON CONFLICT (name) DO NOTHING;

INSERT INTO business_units (name) VALUES
  ('Technology Solutions'),
  ('Enterprise Services'),
  ('Digital Products'),
  ('Corporate')
ON CONFLICT (name) DO NOTHING;

INSERT INTO grades (name, level) VALUES
  ('L1', 1),
  ('L2', 2),
  ('L3', 3),
  ('L4', 4),
  ('L5', 5),
  ('L6', 6),
  ('M1', 7),
  ('M2', 8),
  ('D1', 9),
  ('D2', 10)
ON CONFLICT (name) DO NOTHING;

INSERT INTO locations (name) VALUES
  ('Bangalore'),
  ('Hyderabad'),
  ('Mumbai'),
  ('Pune'),
  ('Chennai'),
  ('Delhi')
ON CONFLICT (name) DO NOTHING;

-- =====================================================
-- 2. COMPETENCIES
-- =====================================================

INSERT INTO competencies (name, description, category, is_active) VALUES
  ('Communication', 'Ability to convey information clearly and effectively', 'Behavioral', true),
  ('Problem Solving', 'Ability to analyze issues and find effective solutions', 'Behavioral', true),
  ('Teamwork', 'Ability to work collaboratively with others', 'Behavioral', true),
  ('Leadership', 'Ability to guide and motivate team members', 'Leadership', true),
  ('Technical Excellence', 'Deep expertise in relevant technical domains', 'Technical', true),
  ('Innovation', 'Ability to think creatively and drive improvements', 'Behavioral', true),
  ('Customer Focus', 'Commitment to understanding and meeting customer needs', 'Behavioral', true),
  ('Time Management', 'Ability to prioritize and manage time effectively', 'Behavioral', true)
ON CONFLICT DO NOTHING;

-- =====================================================
-- 3. PROFILES (Users) - Password: Test@1234 for all
-- =====================================================

-- Password hash for 'Test@1234'
DO $$
DECLARE
  pwd_hash TEXT := '$2a$10$clM9J17.jlifVSLGXaVTSe3MErkZwTlE6Y/.6RWKBnLqta2ynnAA6';
BEGIN

-- System Admin
INSERT INTO profiles (id, email, password_hash, full_name, role)
VALUES ('11111111-1111-1111-1111-111111111111', 'admin@utthunga.com', pwd_hash, 'System Administrator', 'system_admin')
ON CONFLICT (email) DO UPDATE SET role = 'system_admin', full_name = COALESCE(profiles.full_name, 'System Administrator');

-- HR Admin
INSERT INTO profiles (id, email, password_hash, full_name, role)
VALUES ('22222222-2222-2222-2222-222222222222', 'hr.admin@utthunga.com', pwd_hash, 'Sunita Reddy', 'hr_admin')
ON CONFLICT (email) DO UPDATE SET role = 'hr_admin', full_name = COALESCE(profiles.full_name, 'Sunita Reddy');

-- HRBP
INSERT INTO profiles (id, email, password_hash, full_name, role)
VALUES ('33333333-3333-3333-3333-333333333333', 'hrbp@utthunga.com', pwd_hash, 'HR Business Partner', 'hrbp')
ON CONFLICT (email) DO UPDATE SET role = 'hrbp', full_name = COALESCE(profiles.full_name, 'HR Business Partner');

-- Department Head (Engineering)
INSERT INTO profiles (id, email, password_hash, full_name, role)
VALUES ('44444444-4444-4444-4444-444444444444', 'dept.head@utthunga.com', pwd_hash, 'Rajesh Kumar', 'dept_head')
ON CONFLICT (email) DO UPDATE SET role = 'dept_head', full_name = COALESCE(profiles.full_name, 'Rajesh Kumar');

-- Manager 1
INSERT INTO profiles (id, email, password_hash, full_name, role)
VALUES ('55555555-5555-5555-5555-555555555555', 'manager1@utthunga.com', pwd_hash, 'Priya Sharma', 'manager')
ON CONFLICT (email) DO UPDATE SET role = 'manager', full_name = COALESCE(profiles.full_name, 'Priya Sharma');

-- Manager 2
INSERT INTO profiles (id, email, password_hash, full_name, role)
VALUES ('66666666-6666-6666-6666-666666666666', 'manager2@utthunga.com', pwd_hash, 'Amit Patel', 'manager')
ON CONFLICT (email) DO UPDATE SET role = 'manager', full_name = COALESCE(profiles.full_name, 'Amit Patel');

-- Employees
INSERT INTO profiles (id, email, password_hash, full_name, role)
VALUES 
  ('77777777-7777-7777-7777-777777777777', 'john.doe@utthunga.com', pwd_hash, 'John Doe', 'employee'),
  ('88888888-8888-8888-8888-888888888888', 'jane.smith@utthunga.com', pwd_hash, 'Jane Smith', 'employee'),
  ('99999999-9999-9999-9999-999999999999', 'bob.wilson@utthunga.com', pwd_hash, 'Bob Wilson', 'employee'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice.johnson@utthunga.com', pwd_hash, 'Alice Johnson', 'employee'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'charlie.brown@utthunga.com', pwd_hash, 'Charlie Brown', 'employee'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'diana.prince@utthunga.com', pwd_hash, 'Diana Prince', 'employee'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'evan.rogers@utthunga.com', pwd_hash, 'Evan Rogers', 'employee'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'fiona.green@utthunga.com', pwd_hash, 'Fiona Green', 'employee')
ON CONFLICT (email) DO UPDATE SET role = COALESCE(profiles.role, 'employee'), full_name = COALESCE(profiles.full_name, EXCLUDED.full_name);

-- Update existing test user
UPDATE profiles SET password_hash = pwd_hash WHERE email = 'test.user@utthunga.com';

END $$;

-- =====================================================
-- 4. USER ROLES (now stored in profiles.role)
-- =====================================================

-- Note: Roles are now set directly in profiles table during profile creation
-- This section ensures default 'employee' role for any profiles that don't have a role set
UPDATE profiles SET role = 'employee' WHERE role IS NULL;

-- =====================================================
-- 5. EMPLOYEES
-- =====================================================

-- Department Head
INSERT INTO employees (id, emp_code, profile_id, full_name, email, manager_code, department, business_unit, grade, location, status, date_of_joining)
VALUES ('e1111111-1111-1111-1111-111111111111', 'EMP001', '44444444-4444-4444-4444-444444444444', 'Rajesh Kumar', 'dept.head@utthunga.com', NULL, 'Engineering', 'Technology Solutions', 'D1', 'Bangalore', 'active', '2018-01-15')
ON CONFLICT (emp_code) DO NOTHING;

-- Manager 1 (reports to Dept Head)
INSERT INTO employees (id, emp_code, profile_id, full_name, email, manager_code, department, business_unit, grade, location, status, date_of_joining)
VALUES ('e2222222-2222-2222-2222-222222222222', 'EMP002', '55555555-5555-5555-5555-555555555555', 'Priya Sharma', 'manager1@utthunga.com', 'EMP001', 'Engineering', 'Technology Solutions', 'M1', 'Bangalore', 'active', '2019-03-20')
ON CONFLICT (emp_code) DO NOTHING;

-- Manager 2 (reports to Dept Head)
INSERT INTO employees (id, emp_code, profile_id, full_name, email, manager_code, department, business_unit, grade, location, status, date_of_joining)
VALUES ('e3333333-3333-3333-3333-333333333333', 'EMP003', '66666666-6666-6666-6666-666666666666', 'Amit Patel', 'manager2@utthunga.com', 'EMP001', 'Engineering', 'Digital Products', 'M1', 'Hyderabad', 'active', '2019-06-10')
ON CONFLICT (emp_code) DO NOTHING;

-- HR Admin Employee
INSERT INTO employees (id, emp_code, profile_id, full_name, email, manager_code, department, business_unit, grade, location, status, date_of_joining)
VALUES ('e0000001-0000-0000-0000-000000000001', 'EMP000', '22222222-2222-2222-2222-222222222222', 'Sunita Reddy', 'hr.admin@utthunga.com', NULL, 'Human Resources', 'Corporate', 'M2', 'Bangalore', 'active', '2017-05-01')
ON CONFLICT (emp_code) DO NOTHING;

-- Team Members under Manager 1
INSERT INTO employees (id, emp_code, profile_id, full_name, email, manager_code, department, business_unit, grade, location, status, date_of_joining)
VALUES 
  ('e4444444-4444-4444-4444-444444444444', 'EMP004', '77777777-7777-7777-7777-777777777777', 'John Doe', 'john.doe@utthunga.com', 'EMP002', 'Engineering', 'Technology Solutions', 'L3', 'Bangalore', 'active', '2021-01-10'),
  ('e5555555-5555-5555-5555-555555555555', 'EMP005', '88888888-8888-8888-8888-888888888888', 'Jane Smith', 'jane.smith@utthunga.com', 'EMP002', 'Engineering', 'Technology Solutions', 'L4', 'Bangalore', 'active', '2020-07-15'),
  ('e6666666-6666-6666-6666-666666666666', 'EMP006', '99999999-9999-9999-9999-999999999999', 'Bob Wilson', 'bob.wilson@utthunga.com', 'EMP002', 'Engineering', 'Technology Solutions', 'L2', 'Pune', 'active', '2022-03-01'),
  ('e7777777-7777-7777-7777-777777777777', 'EMP007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Alice Johnson', 'alice.johnson@utthunga.com', 'EMP002', 'Engineering', 'Technology Solutions', 'L3', 'Bangalore', 'active', '2021-09-20')
ON CONFLICT (emp_code) DO NOTHING;

-- Team Members under Manager 2
INSERT INTO employees (id, emp_code, profile_id, full_name, email, manager_code, department, business_unit, grade, location, status, date_of_joining)
VALUES 
  ('e8888888-8888-8888-8888-888888888888', 'EMP008', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Charlie Brown', 'charlie.brown@utthunga.com', 'EMP003', 'Engineering', 'Digital Products', 'L3', 'Hyderabad', 'active', '2021-05-12'),
  ('e9999999-9999-9999-9999-999999999999', 'EMP009', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Diana Prince', 'diana.prince@utthunga.com', 'EMP003', 'Engineering', 'Digital Products', 'L4', 'Hyderabad', 'active', '2020-11-08'),
  ('eaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'EMP010', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Evan Rogers', 'evan.rogers@utthunga.com', 'EMP003', 'Engineering', 'Digital Products', 'L2', 'Chennai', 'active', '2022-08-25'),
  ('ebbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'EMP011', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Fiona Green', 'fiona.green@utthunga.com', 'EMP003', 'Engineering', 'Digital Products', 'L3', 'Hyderabad', 'active', '2021-02-14')
ON CONFLICT (emp_code) DO NOTHING;

-- Link existing test user to employee
INSERT INTO employees (id, emp_code, profile_id, full_name, email, manager_code, department, business_unit, grade, location, status, date_of_joining)
SELECT 
  'eccccccc-cccc-cccc-cccc-cccccccccccc', 
  'EMP012', 
  id, 
  'Test User', 
  'test.user@utthunga.com', 
  'EMP002', 
  'Engineering', 
  'Technology Solutions', 
  'L3', 
  'Bangalore', 
  'active', 
  '2023-01-01'
FROM profiles WHERE email = 'test.user@utthunga.com'
ON CONFLICT (emp_code) DO NOTHING;

-- =====================================================
-- 6. PERFORMANCE CYCLE (Active)
-- =====================================================

INSERT INTO performance_cycles (
  id, name, description, status, year,
  goal_submission_start, goal_submission_end, goal_approval_end,
  self_evaluation_start, self_evaluation_end,
  manager_evaluation_start, manager_evaluation_end,
  calibration_start, calibration_end,
  release_date,
  q1_self_review_start, q1_self_review_end, q1_manager_review_start, q1_manager_review_end,
  q2_self_review_start, q2_self_review_end, q2_manager_review_start, q2_manager_review_end,
  q3_self_review_start, q3_self_review_end, q3_manager_review_start, q3_manager_review_end,
  q4_self_review_start, q4_self_review_end, q4_manager_review_start, q4_manager_review_end,
  allow_late_goal_submission
)
VALUES (
  'c1111111-1111-1111-1111-111111111111',
  'FY 2025-2026',
  'Annual Performance Review Cycle for Financial Year 2025-2026',
  'active',
  2025,
  '2025-04-01', '2025-04-30', '2025-05-15',
  '2026-03-01', '2026-03-15',
  '2026-03-16', '2026-03-31',
  '2026-04-01', '2026-04-15',
  '2026-04-20',
  '2025-06-25', '2025-06-30', '2026-01-01', '2026-01-31',
  '2025-09-25', '2025-09-30', '2026-02-01', '2026-02-28',
  '2025-12-25', '2025-12-31', '2026-03-01', '2026-03-31',
  '2026-03-01', '2026-03-07', '2026-04-01', '2026-04-15',
  true
)
ON CONFLICT DO NOTHING;

-- =====================================================
-- 7. KRA TEMPLATES
-- =====================================================

-- Engineering Templates
INSERT INTO kra_templates (id, title, description, suggested_weight, department, grade, is_active)
VALUES 
  ('a1111111-1111-1111-1111-111111111111', 'Project Delivery', 'Deliver assigned projects on time with quality', 30, 'Engineering', NULL, true),
  ('a2222222-2222-2222-2222-222222222222', 'Code Quality & Best Practices', 'Maintain high code quality standards and follow best practices', 25, 'Engineering', NULL, true),
  ('a3333333-3333-3333-3333-333333333333', 'Technical Growth', 'Enhance technical skills and contribute to team knowledge', 20, 'Engineering', NULL, true),
  ('a4444444-4444-4444-4444-444444444444', 'Team Collaboration', 'Work effectively with team members and stakeholders', 15, 'Engineering', NULL, true),
  ('a5555555-5555-5555-5555-555555555555', 'Innovation & Process Improvement', 'Identify and implement process improvements', 10, 'Engineering', NULL, true)
ON CONFLICT DO NOTHING;

-- KPI Templates for Project Delivery KRA
INSERT INTO kpi_templates (kra_template_id, title, description, metric_type, suggested_target, suggested_weight)
VALUES 
  ('a1111111-1111-1111-1111-111111111111', 'On-time Delivery Rate', 'Percentage of tasks delivered on or before deadline', 'percentage', '95', 40),
  ('a1111111-1111-1111-1111-111111111111', 'Defect Rate', 'Number of critical bugs per release', 'number', '2', 30),
  ('a1111111-1111-1111-1111-111111111111', 'Sprint Completion', 'Percentage of sprint commitments completed', 'percentage', '90', 30)
ON CONFLICT DO NOTHING;

-- KPI Templates for Code Quality KRA
INSERT INTO kpi_templates (kra_template_id, title, description, metric_type, suggested_target, suggested_weight)
VALUES 
  ('a2222222-2222-2222-2222-222222222222', 'Code Review Participation', 'Number of code reviews completed per sprint', 'number', '10', 35),
  ('a2222222-2222-2222-2222-222222222222', 'Test Coverage', 'Unit test coverage percentage', 'percentage', '80', 35),
  ('a2222222-2222-2222-2222-222222222222', 'Documentation Updates', 'Keep technical documentation updated', 'milestone', 'Quarterly updates', 30)
ON CONFLICT DO NOTHING;

-- =====================================================
-- 8. SAMPLE KRAs AND KPIs FOR EMPLOYEES
-- =====================================================

-- KRAs for John Doe
INSERT INTO kras (id, employee_id, cycle_id, title, description, weight, status)
VALUES 
  ('b1111111-1111-1111-1111-111111111111', 'e4444444-4444-4444-4444-444444444444', 'c1111111-1111-1111-1111-111111111111', 'Project Delivery Excellence', 'Deliver all assigned features and bug fixes on time with minimal defects', 35, 'approved'),
  ('b2222222-2222-2222-2222-222222222222', 'e4444444-4444-4444-4444-444444444444', 'c1111111-1111-1111-1111-111111111111', 'Code Quality Improvement', 'Maintain high code quality and follow coding standards', 30, 'approved'),
  ('b3333333-3333-3333-3333-333333333333', 'e4444444-4444-4444-4444-444444444444', 'c1111111-1111-1111-1111-111111111111', 'Technical Learning', 'Learn new technologies and share knowledge with team', 20, 'approved'),
  ('b4444444-4444-4444-4444-444444444444', 'e4444444-4444-4444-4444-444444444444', 'c1111111-1111-1111-1111-111111111111', 'Team Collaboration', 'Actively participate in team activities and help teammates', 15, 'approved')
ON CONFLICT DO NOTHING;

-- KPIs (Goals) for John Doe's KRAs
INSERT INTO goals (id, employee_id, cycle_id, kra_id, title, description, goal_type, metric_type, target_value, weight, due_date, status)
VALUES 
  -- Project Delivery KPIs
  ('d1111111-1111-1111-1111-111111111111', 'e4444444-4444-4444-4444-444444444444', 'c1111111-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111', 'On-time Task Completion', 'Complete 95% of assigned tasks within sprint deadlines', 'kpi', 'percentage', '95', 50, '2026-03-31', 'approved'),
  ('d2222222-2222-2222-2222-222222222222', 'e4444444-4444-4444-4444-444444444444', 'c1111111-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111', 'Bug Resolution', 'Resolve assigned bugs within SLA', 'kpi', 'number', '20', 50, '2026-03-31', 'approved'),
  -- Code Quality KPIs
  ('d3333333-3333-3333-3333-333333333333', 'e4444444-4444-4444-4444-444444444444', 'c1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222', 'Code Review Completion', 'Complete at least 8 code reviews per sprint', 'kpi', 'number', '8', 50, '2026-03-31', 'approved'),
  ('d4444444-4444-4444-4444-444444444444', 'e4444444-4444-4444-4444-444444444444', 'c1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222', 'Unit Test Coverage', 'Maintain 80% unit test coverage for new code', 'kpi', 'percentage', '80', 50, '2026-03-31', 'approved'),
  -- Technical Learning KPIs
  ('d5555555-5555-5555-5555-555555555555', 'e4444444-4444-4444-4444-444444444444', 'c1111111-1111-1111-1111-111111111111', 'b3333333-3333-3333-3333-333333333333', 'Technology Certification', 'Complete one relevant certification', 'kpi', 'milestone', 'AWS/Azure/GCP Certification', 60, '2026-03-31', 'approved'),
  ('d6666666-6666-6666-6666-666666666666', 'e4444444-4444-4444-4444-444444444444', 'c1111111-1111-1111-1111-111111111111', 'b3333333-3333-3333-3333-333333333333', 'Knowledge Sharing', 'Conduct 2 tech talks or training sessions', 'kpi', 'number', '2', 40, '2026-03-31', 'approved'),
  -- Team Collaboration KPIs
  ('d7777777-7777-7777-7777-777777777777', 'e4444444-4444-4444-4444-444444444444', 'c1111111-1111-1111-1111-111111111111', 'b4444444-4444-4444-4444-444444444444', 'Mentoring Junior Developers', 'Mentor at least 1 junior team member', 'kpi', 'milestone', 'Successful mentorship', 50, '2026-03-31', 'approved'),
  ('d8888888-8888-8888-8888-888888888888', 'e4444444-4444-4444-4444-444444444444', 'c1111111-1111-1111-1111-111111111111', 'b4444444-4444-4444-4444-444444444444', 'Team Meeting Participation', 'Actively participate in all team meetings', 'kpi', 'percentage', '100', 50, '2026-03-31', 'approved')
ON CONFLICT DO NOTHING;

-- KRAs for Jane Smith (Senior Developer)
INSERT INTO kras (id, employee_id, cycle_id, title, description, weight, status)
VALUES 
  ('b5555555-5555-5555-5555-555555555555', 'e5555555-5555-5555-5555-555555555555', 'c1111111-1111-1111-1111-111111111111', 'Technical Leadership', 'Lead technical initiatives and guide junior developers', 35, 'approved'),
  ('b6666666-6666-6666-6666-666666666666', 'e5555555-5555-5555-5555-555555555555', 'c1111111-1111-1111-1111-111111111111', 'Architecture & Design', 'Design scalable and maintainable solutions', 30, 'approved'),
  ('b7777777-7777-7777-7777-777777777777', 'e5555555-5555-5555-5555-555555555555', 'c1111111-1111-1111-1111-111111111111', 'Delivery Excellence', 'Ensure timely delivery of complex features', 35, 'approved')
ON CONFLICT DO NOTHING;

-- KPIs for Jane Smith
INSERT INTO goals (id, employee_id, cycle_id, kra_id, title, description, goal_type, metric_type, target_value, weight, due_date, status)
VALUES 
  ('d9999999-9999-9999-9999-999999999999', 'e5555555-5555-5555-5555-555555555555', 'c1111111-1111-1111-1111-111111111111', 'b5555555-5555-5555-5555-555555555555', 'Code Review Leadership', 'Review and approve critical code changes', 'kpi', 'number', '50', 50, '2026-03-31', 'approved'),
  ('daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e5555555-5555-5555-5555-555555555555', 'c1111111-1111-1111-1111-111111111111', 'b5555555-5555-5555-5555-555555555555', 'Team Mentoring', 'Mentor 2 junior developers', 'kpi', 'number', '2', 50, '2026-03-31', 'approved'),
  ('dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'e5555555-5555-5555-5555-555555555555', 'c1111111-1111-1111-1111-111111111111', 'b6666666-6666-6666-6666-666666666666', 'Architecture Documents', 'Create architecture documents for major features', 'kpi', 'number', '3', 100, '2026-03-31', 'approved'),
  ('dccccccc-cccc-cccc-cccc-cccccccccccc', 'e5555555-5555-5555-5555-555555555555', 'c1111111-1111-1111-1111-111111111111', 'b7777777-7777-7777-7777-777777777777', 'Feature Delivery', 'Deliver 4 major features', 'kpi', 'number', '4', 100, '2026-03-31', 'approved')
ON CONFLICT DO NOTHING;

-- =====================================================
-- 9. SAMPLE NOTIFICATIONS
-- =====================================================

INSERT INTO notifications (user_id, type, title, message, link, is_read)
SELECT 
  '77777777-7777-7777-7777-777777777777',
  'goal_approval',
  'Goals Approved',
  'Your KRAs and KPIs for FY 2025-2026 have been approved by your manager.',
  '/goals',
  false
WHERE EXISTS (SELECT 1 FROM profiles WHERE id = '77777777-7777-7777-7777-777777777777');

INSERT INTO notifications (user_id, type, title, message, link, is_read)
SELECT 
  '55555555-5555-5555-5555-555555555555',
  'evaluation_pending',
  'Evaluations Pending',
  'You have 4 team members pending evaluation for Q3 review.',
  '/team',
  false
WHERE EXISTS (SELECT 1 FROM profiles WHERE id = '55555555-5555-5555-5555-555555555555');

INSERT INTO notifications (user_id, type, title, message, link, is_read)
SELECT 
  '22222222-2222-2222-2222-222222222222',
  'general',
  'Cycle Reminder',
  'Goal submission period ends in 7 days. Please ensure all employees have submitted their goals.',
  '/admin/cycles',
  false
WHERE EXISTS (SELECT 1 FROM profiles WHERE id = '22222222-2222-2222-2222-222222222222');

-- =====================================================
-- 10. SUMMARY
-- =====================================================
-- 
-- Sample Users Created (Password: Test@1234 for all):
-- 
-- | Email                      | Role(s)                    | Employee Name    |
-- |----------------------------|----------------------------|------------------|
-- | admin@utthunga.com         | system_admin               | -                |
-- | hr.admin@utthunga.com      | hr_admin, employee         | Sunita Reddy     |
-- | hrbp@utthunga.com          | hrbp, employee             | -                |
-- | dept.head@utthunga.com     | dept_head, manager         | Rajesh Kumar     |
-- | manager1@utthunga.com      | manager, employee          | Priya Sharma     |
-- | manager2@utthunga.com      | manager, employee          | Amit Patel       |
-- | john.doe@utthunga.com      | employee                   | John Doe         |
-- | jane.smith@utthunga.com    | employee                   | Jane Smith       |
-- | bob.wilson@utthunga.com    | employee                   | Bob Wilson       |
-- | alice.johnson@utthunga.com | employee                   | Alice Johnson    |
-- | charlie.brown@utthunga.com | employee                   | Charlie Brown    |
-- | diana.prince@utthunga.com  | employee                   | Diana Prince     |
-- | evan.rogers@utthunga.com   | employee                   | Evan Rogers      |
-- | fiona.green@utthunga.com   | employee                   | Fiona Green      |
-- | test.user@utthunga.com     | employee                   | Test User        |
-- 
-- Organization Structure:
-- Rajesh Kumar (Dept Head)
-- ├── Priya Sharma (Manager 1)
-- │   ├── John Doe
-- │   ├── Jane Smith
-- │   ├── Bob Wilson
-- │   ├── Alice Johnson
-- │   └── Test User
-- └── Amit Patel (Manager 2)
--     ├── Charlie Brown
--     ├── Diana Prince
--     ├── Evan Rogers
--     └── Fiona Green
--

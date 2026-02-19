-- Diagnostic query to check why goal_id 1431f1d8-2594-4269-b3e3-91ddc32ae370 
-- is not accepting ratings in goal_self_ratings table

-- 1. Check if the goal exists in the goals table
SELECT 
    'Goal Exists Check' as check_type,
    id,
    title,
    employee_id,
    status,
    created_at
FROM goals 
WHERE id = '1431f1d8-2594-4269-b3e3-91ddc32ae370';

-- 2. Check existing ratings for this goal_id
SELECT 
    'Existing Ratings' as check_type,
    gsr.id,
    gsr.quarterly_review_id,
    gsr.goal_id,
    gsr.self_rating,
    gsr.achievement,
    gsr.created_at,
    qsr.employee_id,
    qsr.cycle_id,
    qsr.quarter
FROM goal_self_ratings gsr
LEFT JOIN quarterly_self_reviews qsr ON gsr.quarterly_review_id = qsr.id
WHERE gsr.goal_id = '1431f1d8-2594-4269-b3e3-91ddc32ae370'
ORDER BY gsr.created_at DESC;

-- 3. Check if there are any quarterly_self_reviews that should be linked
SELECT 
    'Available Quarterly Reviews' as check_type,
    qsr.id as quarterly_review_id,
    qsr.employee_id,
    qsr.cycle_id,
    qsr.quarter,
    qsr.period_type,
    qsr.status,
    g.id as goal_id,
    g.title as goal_title
FROM quarterly_self_reviews qsr
INNER JOIN goals g ON g.employee_id = qsr.employee_id 
    AND g.cycle_id = qsr.cycle_id
    AND g.quarter = qsr.quarter
WHERE g.id = '1431f1d8-2594-4269-b3e3-91ddc32ae370'
ORDER BY qsr.created_at DESC;

-- 4. Check goal details and its relationship
SELECT 
    'Goal Details' as check_type,
    g.id,
    g.title,
    g.employee_id,
    g.cycle_id,
    g.quarter,
    g.status as goal_status,
    e.full_name as employee_name,
    e.email as employee_email
FROM goals g
LEFT JOIN employees e ON g.employee_id = e.id
WHERE g.id = '1431f1d8-2594-4269-b3e3-91ddc32ae370';

-- 5. Check for any constraint violations (recent errors in logs would show this)
-- This query checks if there's a mismatch between goal and quarterly_review
SELECT 
    'Potential Mismatch' as check_type,
    g.id as goal_id,
    g.employee_id as goal_employee_id,
    g.cycle_id as goal_cycle_id,
    g.quarter as goal_quarter,
    qsr.id as quarterly_review_id,
    qsr.employee_id as review_employee_id,
    qsr.cycle_id as review_cycle_id,
    qsr.quarter as review_quarter,
    CASE 
        WHEN g.employee_id != qsr.employee_id THEN 'Employee ID mismatch'
        WHEN g.cycle_id != qsr.cycle_id THEN 'Cycle ID mismatch'
        WHEN g.quarter != qsr.quarter THEN 'Quarter mismatch'
        ELSE 'OK'
    END as validation_status
FROM goals g
CROSS JOIN quarterly_self_reviews qsr
WHERE g.id = '1431f1d8-2594-4269-b3e3-91ddc32ae370'
    AND qsr.employee_id = g.employee_id
    AND qsr.cycle_id = g.cycle_id
    AND qsr.quarter = g.quarter;

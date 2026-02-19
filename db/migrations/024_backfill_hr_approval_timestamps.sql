-- Migration: Backfill HR approval timestamps for existing PUBLISHED ratings
-- This migration updates quarterly_manager_reviews with hr_approved_at, hr_approved_by, and released_at
-- for all employees who have PUBLISHED normalized_ratings but missing these timestamps

-- Backfill hr_approved_at, hr_approved_by, and released_at in quarterly_manager_reviews
-- for all PUBLISHED normalized_ratings where these fields are NULL
DO $$
DECLARE
    v_count INTEGER;
    v_hr_user_id UUID;
BEGIN
    -- Get a default HR user ID (first HR admin user found, or NULL if none)
    -- This is a fallback - ideally we'd track who published, but for historical data we use a default
    SELECT id INTO v_hr_user_id
    FROM profiles
    WHERE role IN ('hr_admin'::app_role, 'hrbp'::app_role, 'system_admin'::app_role)
    ORDER BY created_at ASC
    LIMIT 1;
    
    -- If no HR user found, we'll set hr_approved_by to NULL (historical data)
    -- hr_approved_at and released_at will still be set to the normalized_ratings updated_at
    
    -- Update quarterly_manager_reviews for all PUBLISHED normalized_ratings
    UPDATE quarterly_manager_reviews qmr
    SET 
        hr_approved_at = COALESCE(qmr.hr_approved_at, nr.updated_at),
        hr_approved_by = COALESCE(qmr.hr_approved_by, v_hr_user_id),
        released_at = COALESCE(qmr.released_at, nr.updated_at),
        updated_at = GREATEST(qmr.updated_at, nr.updated_at)
    FROM normalized_ratings nr
    WHERE qmr.employee_id = nr.employee_id
        AND qmr.cycle_id = nr.performance_cycle_id
        AND qmr.quarter = nr.quarter
        AND nr.status = 'PUBLISHED'
        AND (qmr.hr_approved_at IS NULL OR qmr.released_at IS NULL);
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    
    RAISE NOTICE 'Backfilled HR approval timestamps for % quarterly_manager_reviews records', v_count;
END $$;

-- Create index to improve join performance for future queries
CREATE INDEX IF NOT EXISTS idx_quarterly_manager_reviews_hr_approved 
    ON quarterly_manager_reviews(employee_id, cycle_id, quarter, hr_approved_at)
    WHERE hr_approved_at IS NOT NULL;

-- Add comment explaining the backfill
COMMENT ON COLUMN quarterly_manager_reviews.hr_approved_at IS 
    'Timestamp when HR approved the manager review. Backfilled from normalized_ratings.updated_at for historical PUBLISHED ratings.';

COMMENT ON COLUMN quarterly_manager_reviews.hr_approved_by IS 
    'UUID of HR user who approved the review. For historical data, may be NULL or set to first HR admin found.';

COMMENT ON COLUMN quarterly_manager_reviews.released_at IS 
    'Timestamp when HR published/released the rating to employee. Backfilled from normalized_ratings.updated_at for historical PUBLISHED ratings.';

-- Migration: Add transition_id to manager_history for direct linking
-- This creates a proper foreign key relationship between manager_history and employee_quarter_transitions
-- Run after: 021_add_mid_quarter_transitions.sql

-- Add transition_id column to manager_history
ALTER TABLE manager_history
ADD COLUMN IF NOT EXISTS transition_id UUID REFERENCES employee_quarter_transitions(id) ON DELETE SET NULL;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_manager_history_transition_id 
    ON manager_history(transition_id);

-- Create index for employee + transition lookup
CREATE INDEX IF NOT EXISTS idx_manager_history_employee_transition 
    ON manager_history(employee_id, transition_id);

-- Add comment
COMMENT ON COLUMN manager_history.transition_id IS 
    'Direct reference to employee_quarter_transitions. Links manager change to specific transition record.';

-- Backfill transition_id for existing manager_history records
-- Match by employee_id and effective_date = transition_date
UPDATE manager_history mh
SET transition_id = eqt.id
FROM employee_quarter_transitions eqt
WHERE mh.employee_id = eqt.employee_id
  AND mh.effective_date = eqt.transition_date
  AND mh.transition_id IS NULL
  AND (
    (mh.old_manager_id = eqt.old_manager_id AND mh.new_manager_id = eqt.new_manager_id)
    OR (mh.old_manager_id IS NULL AND eqt.old_manager_id IS NULL AND mh.new_manager_id = eqt.new_manager_id)
    OR (mh.new_manager_id IS NULL AND eqt.new_manager_id IS NULL AND mh.old_manager_id = eqt.old_manager_id)
  );

-- Create missing manager_history records for transitions that don't have one
-- Only for transitions where manager actually changed
INSERT INTO manager_history (employee_id, old_manager_id, new_manager_id, effective_date, changed_by, transition_id)
SELECT 
  eqt.employee_id,
  eqt.old_manager_id,
  eqt.new_manager_id,
  eqt.transition_date,
  eqt.created_by,
  eqt.id
FROM employee_quarter_transitions eqt
WHERE eqt.old_manager_id != eqt.new_manager_id
  AND (eqt.old_manager_id IS NOT NULL OR eqt.new_manager_id IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM manager_history mh
    WHERE mh.transition_id = eqt.id
  )
ON CONFLICT DO NOTHING;

-- Migration: Create email_reminders table for tracking sent reminder emails
-- Prevents duplicate emails for the same reminder event
-- Date: 2025

-- Step 1: Create email_reminders table
CREATE TABLE IF NOT EXISTS public.email_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    reminder_type VARCHAR(100) NOT NULL, -- 'goal_submission', 'goals_manager_review', 'self_review', 'manager_review'
    reminder_date DATE NOT NULL, -- The date the reminder was sent
    target_date DATE NOT NULL, -- The milestone date (end_date or start_date)
    quarter INTEGER, -- Quarter number (1-4) if applicable
    cycle_id UUID REFERENCES public.performance_cycles(id) ON DELETE CASCADE,
    days_before INTEGER, -- Days before target date (3, 2, 1, 0 for end dates, NULL for start dates)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create unique index that handles NULLs properly using COALESCE
-- This ensures one reminder per employee per reminder type per reminder date per target date per quarter per days_before
-- NULLs are converted to empty strings for comparison
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_reminders_unique 
    ON public.email_reminders(
        employee_id, 
        reminder_type, 
        reminder_date, 
        target_date, 
        COALESCE(quarter::text, ''), 
        COALESCE(days_before::text, '')
    );

-- Step 2: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_email_reminders_employee_id 
    ON public.email_reminders(employee_id);

CREATE INDEX IF NOT EXISTS idx_email_reminders_reminder_type 
    ON public.email_reminders(reminder_type);

CREATE INDEX IF NOT EXISTS idx_email_reminders_reminder_date 
    ON public.email_reminders(reminder_date);

CREATE INDEX IF NOT EXISTS idx_email_reminders_target_date 
    ON public.email_reminders(target_date);

CREATE INDEX IF NOT EXISTS idx_email_reminders_cycle_quarter 
    ON public.email_reminders(cycle_id, quarter);

-- Step 3: Add comment for documentation
COMMENT ON TABLE public.email_reminders IS 'Tracks sent email reminders to prevent duplicates';
COMMENT ON COLUMN public.email_reminders.reminder_type IS 'Type of reminder: goal_submission, goals_manager_review, self_review, manager_review';
COMMENT ON COLUMN public.email_reminders.reminder_date IS 'Date when the reminder email was sent';
COMMENT ON COLUMN public.email_reminders.target_date IS 'The milestone date (end_date or start_date) for which reminder was sent';
COMMENT ON COLUMN public.email_reminders.days_before IS 'Days before target date (3, 2, 1, 0 for end dates, NULL for start dates)';

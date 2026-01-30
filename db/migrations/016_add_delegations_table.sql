-- Migration: Add delegations table for manager delegation feature
-- Allows managers to delegate goals and evaluation responsibilities per quarter
-- Date: 2024

-- Step 1: Create delegations table
CREATE TABLE IF NOT EXISTS public.delegations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manager_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    delegate_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    reportee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    cycle_id UUID NOT NULL REFERENCES public.performance_cycles(id) ON DELETE CASCADE,
    quarter INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    
    -- Ensure one active delegation per manager-reportee-quarter-cycle
    CONSTRAINT delegations_unique_active UNIQUE (manager_id, reportee_id, cycle_id, quarter, revoked_at)
);

-- Step 2: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_delegations_manager_id 
    ON public.delegations(manager_id);

CREATE INDEX IF NOT EXISTS idx_delegations_delegate_id 
    ON public.delegations(delegate_id);

CREATE INDEX IF NOT EXISTS idx_delegations_reportee_id 
    ON public.delegations(reportee_id);

CREATE INDEX IF NOT EXISTS idx_delegations_cycle_id 
    ON public.delegations(cycle_id);

CREATE INDEX IF NOT EXISTS idx_delegations_quarter 
    ON public.delegations(quarter);

CREATE INDEX IF NOT EXISTS idx_delegations_active 
    ON public.delegations(manager_id, reportee_id, cycle_id, quarter) 
    WHERE revoked_at IS NULL;

-- Step 3: Add comments for documentation
COMMENT ON TABLE delegations IS 'Stores manager delegations for goals and evaluations per quarter';
COMMENT ON COLUMN delegations.manager_id IS 'The manager who is delegating responsibilities';
COMMENT ON COLUMN delegations.delegate_id IS 'The employee receiving delegated responsibilities';
COMMENT ON COLUMN delegations.reportee_id IS 'The employee whose goals/evaluations are being delegated';
COMMENT ON COLUMN delegations.quarter IS 'Quarter number: 1 (Q1), 2 (Q2), 3 (Q3), or 4 (Q4)';
COMMENT ON COLUMN delegations.revoked_at IS 'Timestamp when delegation was revoked (NULL = active)';

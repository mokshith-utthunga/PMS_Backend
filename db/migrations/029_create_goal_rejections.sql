-- Migration: Create goal rejections tracking table
-- This table tracks manager-level rejection of goals (KRAs and KPIs) during goal approval workflow
-- Enforces single rejection per goal per quarter per manager
-- Separate from kra_kpi_rejections which is for evaluation workflow

-- Create table for tracking goal rejections
CREATE TABLE IF NOT EXISTS public.goal_rejections
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    kra_id uuid,
    goal_id uuid,
    quarter integer NOT NULL,
    cycle_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    rejected_by uuid NOT NULL,
    rejection_reason text NOT NULL,
    rejected_at timestamp with time zone NOT NULL DEFAULT now(),
    resubmitted_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT goal_rejections_pkey PRIMARY KEY (id),
    CONSTRAINT goal_rejections_kra_id_fkey FOREIGN KEY (kra_id)
        REFERENCES public.kras (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT goal_rejections_goal_id_fkey FOREIGN KEY (goal_id)
        REFERENCES public.goals (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT goal_rejections_cycle_id_fkey FOREIGN KEY (cycle_id)
        REFERENCES public.performance_cycles (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT goal_rejections_employee_id_fkey FOREIGN KEY (employee_id)
        REFERENCES public.employees (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT goal_rejections_rejected_by_fkey FOREIGN KEY (rejected_by)
        REFERENCES public.employees (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT goal_rejections_kra_or_goal_check CHECK (
        (kra_id IS NOT NULL AND goal_id IS NULL) OR 
        (kra_id IS NULL AND goal_id IS NOT NULL)
    ),
    CONSTRAINT goal_rejections_quarter_check CHECK (quarter >= 1 AND quarter <= 4)
)
TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.goal_rejections
    OWNER to postgres;

COMMENT ON TABLE public.goal_rejections IS 
    'Tracks manager-level rejection of goals (KRAs and KPIs) during goal approval workflow. Enforces single rejection per goal per quarter per manager.';

COMMENT ON COLUMN public.goal_rejections.kra_id IS 
    'Reference to rejected KRA. Either kra_id or goal_id must be set, but not both.';

COMMENT ON COLUMN public.goal_rejections.goal_id IS 
    'Reference to rejected KPI (goal). Either kra_id or goal_id must be set, but not both.';

COMMENT ON COLUMN public.goal_rejections.rejected_by IS 
    'Employee ID of the manager who rejected this goal.';

COMMENT ON COLUMN public.goal_rejections.resubmitted_at IS 
    'Timestamp when employee resubmitted the rejected goal. NULL means not yet resubmitted.';

-- Create unique constraint to enforce single rejection per goal per quarter per manager
-- This prevents infinite rejection loops
CREATE UNIQUE INDEX IF NOT EXISTS goal_rejections_unique_rejection
    ON public.goal_rejections (
        COALESCE(kra_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(goal_id, '00000000-0000-0000-0000-000000000000'::uuid),
        quarter,
        cycle_id,
        employee_id,
        rejected_by
    )
    WHERE resubmitted_at IS NULL;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_goal_rejections_kra
    ON public.goal_rejections (kra_id)
    WHERE kra_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_goal_rejections_goal
    ON public.goal_rejections (goal_id)
    WHERE goal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_goal_rejections_employee_quarter
    ON public.goal_rejections (employee_id, cycle_id, quarter);

CREATE INDEX IF NOT EXISTS idx_goal_rejections_rejected_by
    ON public.goal_rejections (rejected_by);

CREATE INDEX IF NOT EXISTS idx_goal_rejections_resubmitted
    ON public.goal_rejections (resubmitted_at)
    WHERE resubmitted_at IS NOT NULL;

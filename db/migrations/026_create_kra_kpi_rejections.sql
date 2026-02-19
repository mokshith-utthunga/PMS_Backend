-- Migration: Create KRA/KPI rejection tracking table
-- This table tracks manager-level rejection of specific KRAs and KPIs at the granular level
-- Enforces single rejection per KRA/KPI per quarter per manager

-- Create table for tracking KRA/KPI rejections
CREATE TABLE IF NOT EXISTS public.kra_kpi_rejections
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    manager_review_id uuid NOT NULL,
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
    CONSTRAINT kra_kpi_rejections_pkey PRIMARY KEY (id),
    CONSTRAINT kra_kpi_rejections_manager_review_id_fkey FOREIGN KEY (manager_review_id)
        REFERENCES public.quarterly_manager_reviews (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT kra_kpi_rejections_kra_id_fkey FOREIGN KEY (kra_id)
        REFERENCES public.kras (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT kra_kpi_rejections_goal_id_fkey FOREIGN KEY (goal_id)
        REFERENCES public.goals (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT kra_kpi_rejections_cycle_id_fkey FOREIGN KEY (cycle_id)
        REFERENCES public.performance_cycles (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT kra_kpi_rejections_employee_id_fkey FOREIGN KEY (employee_id)
        REFERENCES public.employees (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT kra_kpi_rejections_rejected_by_fkey FOREIGN KEY (rejected_by)
        REFERENCES public.employees (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT kra_kpi_rejections_kra_or_goal_check CHECK (
        (kra_id IS NOT NULL AND goal_id IS NULL) OR 
        (kra_id IS NULL AND goal_id IS NOT NULL)
    ),
    CONSTRAINT kra_kpi_rejections_quarter_check CHECK (quarter >= 1 AND quarter <= 4)
)
TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.kra_kpi_rejections
    OWNER to postgres;

COMMENT ON TABLE public.kra_kpi_rejections IS 
    'Tracks manager-level rejection of specific KRAs and KPIs. Enforces single rejection per KRA/KPI per quarter per manager.';

COMMENT ON COLUMN public.kra_kpi_rejections.kra_id IS 
    'Reference to rejected KRA. Either kra_id or goal_id must be set, but not both.';

COMMENT ON COLUMN public.kra_kpi_rejections.goal_id IS 
    'Reference to rejected KPI (goal). Either kra_id or goal_id must be set, but not both.';

COMMENT ON COLUMN public.kra_kpi_rejections.rejected_by IS 
    'Employee ID of the manager who rejected this KRA/KPI.';

COMMENT ON COLUMN public.kra_kpi_rejections.resubmitted_at IS 
    'Timestamp when employee resubmitted the rejected KRA/KPI. NULL means not yet resubmitted.';

-- Create unique constraint to enforce single rejection per KRA/KPI per quarter per manager
-- This prevents infinite rejection loops
CREATE UNIQUE INDEX IF NOT EXISTS kra_kpi_rejections_unique_rejection
    ON public.kra_kpi_rejections (
        COALESCE(kra_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(goal_id, '00000000-0000-0000-0000-000000000000'::uuid),
        quarter,
        cycle_id,
        employee_id,
        rejected_by
    )
    WHERE resubmitted_at IS NULL;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_kra_kpi_rejections_manager_review
    ON public.kra_kpi_rejections (manager_review_id);

CREATE INDEX IF NOT EXISTS idx_kra_kpi_rejections_kra
    ON public.kra_kpi_rejections (kra_id)
    WHERE kra_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kra_kpi_rejections_goal
    ON public.kra_kpi_rejections (goal_id)
    WHERE goal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kra_kpi_rejections_employee_quarter
    ON public.kra_kpi_rejections (employee_id, cycle_id, quarter);

CREATE INDEX IF NOT EXISTS idx_kra_kpi_rejections_rejected_by
    ON public.kra_kpi_rejections (rejected_by);

CREATE INDEX IF NOT EXISTS idx_kra_kpi_rejections_resubmitted
    ON public.kra_kpi_rejections (resubmitted_at)
    WHERE resubmitted_at IS NOT NULL;

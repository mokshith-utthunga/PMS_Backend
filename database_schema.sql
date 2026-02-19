
--profile table
CREATE TYPE app_role AS ENUM (
  'employee',
  'manager',
  'dept_head',
  'hr_admin',
  'hrbp',
  'system_admin'
);

CREATE TABLE IF NOT EXISTS public.profiles
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    email text COLLATE pg_catalog."default" NOT NULL,
    password_hash text COLLATE pg_catalog."default" NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    role app_role NOT NULL DEFAULT 'employee'::app_role,
    full_name character varying(255) COLLATE pg_catalog."default",
    CONSTRAINT profiles_pkey PRIMARY KEY (id),
    CONSTRAINT profiles_email_key UNIQUE (email)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.profiles
    OWNER to postgres;


CREATE INDEX IF NOT EXISTS idx_profiles_role
    ON public.profiles USING btree
    (role ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

---Employee

CREATE TYPE employee_status AS ENUM (
  'active',
  'inactive',
  'on_leave',
  'terminated'
);


CREATE TABLE IF NOT EXISTS public.employees
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    emp_code text COLLATE pg_catalog."default" NOT NULL,
    profile_id uuid,
    email text COLLATE pg_catalog."default" NOT NULL,
    manager_code character varying(255) COLLATE pg_catalog."default",
    department text COLLATE pg_catalog."default" NOT NULL,
    business_unit text COLLATE pg_catalog."default" NOT NULL,
    grade text COLLATE pg_catalog."default" NOT NULL,
    location text COLLATE pg_catalog."default" NOT NULL,
    status employee_status NOT NULL DEFAULT 'active'::employee_status,
    date_of_joining date NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    sub_department text COLLATE pg_catalog."default",
    full_name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    CONSTRAINT employees_pkey PRIMARY KEY (id),
    CONSTRAINT employees_email_key UNIQUE (email),
    CONSTRAINT employees_emp_code_key UNIQUE (emp_code),
    CONSTRAINT employees_emp_id_key UNIQUE (emp_code),
    CONSTRAINT employees_profile_id_fkey FOREIGN KEY (profile_id)
        REFERENCES public.profiles (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.employees
    OWNER to postgres;
-- Index: idx_employees_department

-- DROP INDEX IF EXISTS public.idx_employees_department;

CREATE INDEX IF NOT EXISTS idx_employees_department
    ON public.employees USING btree
    (department COLLATE pg_catalog."default" ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
-- Index: idx_employees_manager_code

-- DROP INDEX IF EXISTS public.idx_employees_manager_code;

CREATE INDEX IF NOT EXISTS idx_employees_manager_code
    ON public.employees USING btree
    (manager_code COLLATE pg_catalog."default" ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
-- Index: idx_employees_profile_id

-- DROP INDEX IF EXISTS public.idx_employees_profile_id;

CREATE INDEX IF NOT EXISTS idx_employees_profile_id
    ON public.employees USING btree
    (profile_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

---performance_cycle

CREATE TYPE cycle_status AS ENUM (
  'draft',
  'active',
  'closed',
  'archived'
);

CREATE TABLE IF NOT EXISTS public.performance_cycles
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text COLLATE pg_catalog."default" NOT NULL,
    description text COLLATE pg_catalog."default",
    status cycle_status NOT NULL DEFAULT 'draft'::cycle_status,
    year integer NOT NULL,
    calibration_start date,
    calibration_end date,
    release_date date NOT NULL,
    allow_late_goal_submission boolean NOT NULL DEFAULT false,
    applicable_departments text[] COLLATE pg_catalog."default",
    applicable_business_units text[] COLLATE pg_catalog."default",
    created_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT performance_cycles_pkey PRIMARY KEY (id),
    CONSTRAINT performance_cycles_created_by_fkey FOREIGN KEY (created_by)
        REFERENCES public.profiles (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.performance_cycles
    OWNER to postgres;

CREATE INDEX IF NOT EXISTS idx_performance_cycles_active_year
    ON public.performance_cycles USING btree
    (year DESC NULLS FIRST, status ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default
    WHERE status = 'active'::cycle_status;
-- Index: idx_performance_cycles_applicable_business_units

-- DROP INDEX IF EXISTS public.idx_performance_cycles_applicable_business_units;

CREATE INDEX IF NOT EXISTS idx_performance_cycles_applicable_business_units
    ON public.performance_cycles USING gin
    (applicable_business_units COLLATE pg_catalog."default")
    WITH (fastupdate=True, gin_pending_list_limit=2097151)
    TABLESPACE pg_default
    WHERE applicable_business_units IS NOT NULL;
-- Index: idx_performance_cycles_applicable_departments

-- DROP INDEX IF EXISTS public.idx_performance_cycles_applicable_departments;

CREATE INDEX IF NOT EXISTS idx_performance_cycles_applicable_departments
    ON public.performance_cycles USING gin
    (applicable_departments COLLATE pg_catalog."default")
    WITH (fastupdate=True, gin_pending_list_limit=2097151)
    TABLESPACE pg_default
    WHERE applicable_departments IS NOT NULL;
-- Index: idx_performance_cycles_created_at

-- DROP INDEX IF EXISTS public.idx_performance_cycles_created_at;

CREATE INDEX IF NOT EXISTS idx_performance_cycles_created_at
    ON public.performance_cycles USING btree
    (created_at DESC NULLS FIRST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
-- Index: idx_performance_cycles_created_by

-- DROP INDEX IF EXISTS public.idx_performance_cycles_created_by;

CREATE INDEX IF NOT EXISTS idx_performance_cycles_created_by
    ON public.performance_cycles USING btree
    (created_by ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default
    WHERE created_by IS NOT NULL;
-- Index: idx_performance_cycles_status

-- DROP INDEX IF EXISTS public.idx_performance_cycles_status;

CREATE INDEX IF NOT EXISTS idx_performance_cycles_status
    ON public.performance_cycles USING btree
    (status ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default
    WHERE status = ANY (ARRAY['active'::cycle_status, 'draft'::cycle_status]);
-- Index: idx_performance_cycles_year

-- DROP INDEX IF EXISTS public.idx_performance_cycles_year;

CREATE INDEX IF NOT EXISTS idx_performance_cycles_year
    ON public.performance_cycles USING btree
    (year DESC NULLS FIRST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

--Delegation
CREATE TABLE IF NOT EXISTS public.delegations
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    manager_id uuid NOT NULL,
    delegate_id uuid NOT NULL,
    reportee_id uuid NOT NULL,
    cycle_id uuid NOT NULL,
    quarter integer NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    revoked_at timestamp with time zone,
    CONSTRAINT delegations_pkey PRIMARY KEY (id),
    CONSTRAINT delegations_unique_active UNIQUE (manager_id, reportee_id, cycle_id, quarter, revoked_at),
    CONSTRAINT delegations_cycle_id_fkey FOREIGN KEY (cycle_id)
        REFERENCES public.performance_cycles (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT delegations_delegate_id_fkey FOREIGN KEY (delegate_id)
        REFERENCES public.employees (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT delegations_manager_id_fkey FOREIGN KEY (manager_id)
        REFERENCES public.employees (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT delegations_reportee_id_fkey FOREIGN KEY (reportee_id)
        REFERENCES public.employees (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT delegations_quarter_check CHECK (quarter >= 1 AND quarter <= 4)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.delegations
    OWNER to postgres;


CREATE INDEX IF NOT EXISTS idx_delegations_active
    ON public.delegations USING btree
    (manager_id ASC NULLS LAST, reportee_id ASC NULLS LAST, cycle_id ASC NULLS LAST, quarter ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default
    WHERE revoked_at IS NULL;


CREATE INDEX IF NOT EXISTS idx_delegations_cycle_id
    ON public.delegations USING btree
    (cycle_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;


CREATE INDEX IF NOT EXISTS idx_delegations_delegate_id
    ON public.delegations USING btree
    (delegate_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_delegations_manager_id
    ON public.delegations USING btree
    (manager_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_delegations_quarter
    ON public.delegations USING btree
    (quarter ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_delegations_reportee_id
    ON public.delegations USING btree
    (reportee_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;


---quarterly_cycles
CREATE TABLE IF NOT EXISTS public.quarterly_cycles
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    performance_cycle_id uuid NOT NULL,
    quarter integer NOT NULL,
    quarter_start_date date NOT NULL,
    quarter_end_date date NOT NULL,
    self_review_start_date date,
    self_review_end_date date,
    manager_review_start_date date NOT NULL,
    manager_review_end_date date NOT NULL,
    status cycle_status NOT NULL DEFAULT 'draft'::cycle_status,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT quarterly_cycles_pkey PRIMARY KEY (id),
    CONSTRAINT quarterly_cycles_unique UNIQUE (performance_cycle_id, quarter),
    CONSTRAINT quarterly_cycles_performance_cycle_fkey FOREIGN KEY (performance_cycle_id)
        REFERENCES public.performance_cycles (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT quarterly_cycles_quarter_check CHECK (quarter >= 1 AND quarter <= 4),
    CONSTRAINT quarterly_cycles_quarter_range_check CHECK (quarter_start_date <= quarter_end_date)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.quarterly_cycles
    OWNER to postgres;

COMMENT ON TABLE public.quarterly_cycles
    IS 'Stores quarterly evaluation cycles (replaces q1_*, q2_*, q3_*, q4_* columns in performance_cycles)';

COMMENT ON COLUMN public.quarterly_cycles.quarter
    IS 'Quarter number: 1 (Q1), 2 (Q2), 3 (Q3), or 4 (Q4)';
-- Index: idx_quarterly_cycles_active_cycle_quarter

-- DROP INDEX IF EXISTS public.idx_quarterly_cycles_active_cycle_quarter;

CREATE INDEX IF NOT EXISTS idx_quarterly_cycles_active_cycle_quarter
    ON public.quarterly_cycles USING btree
    (performance_cycle_id ASC NULLS LAST, quarter ASC NULLS LAST, status ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default
    WHERE status = 'active'::cycle_status;
-- Index: idx_quarterly_cycles_manager_review_end_date

-- DROP INDEX IF EXISTS public.idx_quarterly_cycles_manager_review_end_date;

CREATE INDEX IF NOT EXISTS idx_quarterly_cycles_manager_review_end_date
    ON public.quarterly_cycles USING btree
    (manager_review_end_date ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
-- Index: idx_quarterly_cycles_performance_cycle_id

-- DROP INDEX IF EXISTS public.idx_quarterly_cycles_performance_cycle_id;

CREATE INDEX IF NOT EXISTS idx_quarterly_cycles_performance_cycle_id
    ON public.quarterly_cycles USING btree
    (performance_cycle_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
-- Index: idx_quarterly_cycles_quarter

-- DROP INDEX IF EXISTS public.idx_quarterly_cycles_quarter;

CREATE INDEX IF NOT EXISTS idx_quarterly_cycles_quarter
    ON public.quarterly_cycles USING btree
    (quarter ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
-- Index: idx_quarterly_cycles_quarter_end_date

-- DROP INDEX IF EXISTS public.idx_quarterly_cycles_quarter_end_date;

CREATE INDEX IF NOT EXISTS idx_quarterly_cycles_quarter_end_date
    ON public.quarterly_cycles USING btree
    (quarter_end_date ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
-- Index: idx_quarterly_cycles_quarter_start_date

-- DROP INDEX IF EXISTS public.idx_quarterly_cycles_quarter_start_date;

CREATE INDEX IF NOT EXISTS idx_quarterly_cycles_quarter_start_date
    ON public.quarterly_cycles USING btree
    (quarter_start_date ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
-- Index: idx_quarterly_cycles_self_review_end_date

-- DROP INDEX IF EXISTS public.idx_quarterly_cycles_self_review_end_date;

CREATE INDEX IF NOT EXISTS idx_quarterly_cycles_self_review_end_date
    ON public.quarterly_cycles USING btree
    (self_review_end_date ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default
    WHERE self_review_end_date IS NOT NULL;
-- Index: idx_quarterly_cycles_status

-- DROP INDEX IF EXISTS public.idx_quarterly_cycles_status;

CREATE INDEX IF NOT EXISTS idx_quarterly_cycles_status
    ON public.quarterly_cycles USING btree
    (status ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
-- Index: idx_quarterly_cycles_status_active

-- DROP INDEX IF EXISTS public.idx_quarterly_cycles_status_active;

CREATE INDEX IF NOT EXISTS idx_quarterly_cycles_status_active
    ON public.quarterly_cycles USING btree
    (status ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default
    WHERE status = 'active'::cycle_status;

---goals_quarterly_cycles
CREATE TABLE IF NOT EXISTS public.goals_quarterly_cycles
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    performance_cycle_id uuid NOT NULL,
    quarter integer NOT NULL,
    goal_submission_start_date date NOT NULL,
    goal_submission_end_date date NOT NULL,
    manager_review_start_date date NOT NULL,
    manager_review_end_date date NOT NULL,
    allow_late_goal_submission boolean NOT NULL DEFAULT false,
    status cycle_status NOT NULL DEFAULT 'draft'::cycle_status,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    quarterly_cycle_id uuid,
    CONSTRAINT goals_quarterly_cycles_pkey PRIMARY KEY (id),
    CONSTRAINT goals_quarterly_cycles_unique UNIQUE (performance_cycle_id, quarter),
    CONSTRAINT goals_qc_performance_cycle_fkey FOREIGN KEY (performance_cycle_id)
        REFERENCES public.performance_cycles (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT goals_qc_quarterly_cycle_fkey FOREIGN KEY (quarterly_cycle_id)
        REFERENCES public.quarterly_cycles (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT goals_quarterly_cycles_quarter_check CHECK (quarter >= 1 AND quarter <= 4)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.goals_quarterly_cycles
    OWNER to postgres;

COMMENT ON TABLE public.goals_quarterly_cycles
    IS 'Stores quarterly goal submission and approval timelines, separate from evaluation cycles';

COMMENT ON COLUMN public.goals_quarterly_cycles.quarter
    IS 'Quarter number: 1 (Q1), 2 (Q2), 3 (Q3), or 4 (Q4)';

COMMENT ON COLUMN public.goals_quarterly_cycles.allow_late_goal_submission
    IS 'Whether late goal submission is allowed for this quarter';
-- Index: idx_goals_quarterly_cycles_active_cycle_quarter

-- DROP INDEX IF EXISTS public.idx_goals_quarterly_cycles_active_cycle_quarter;

CREATE INDEX IF NOT EXISTS idx_goals_quarterly_cycles_active_cycle_quarter
    ON public.goals_quarterly_cycles USING btree
    (performance_cycle_id ASC NULLS LAST, quarter ASC NULLS LAST, status ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default
    WHERE status = 'active'::cycle_status;
-- Index: idx_goals_quarterly_cycles_allow_late

-- DROP INDEX IF EXISTS public.idx_goals_quarterly_cycles_allow_late;

CREATE INDEX IF NOT EXISTS idx_goals_quarterly_cycles_allow_late
    ON public.goals_quarterly_cycles USING btree
    (performance_cycle_id ASC NULLS LAST, quarter ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default
    WHERE allow_late_goal_submission = true;
-- Index: idx_goals_quarterly_cycles_goal_submission_end_date

-- DROP INDEX IF EXISTS public.idx_goals_quarterly_cycles_goal_submission_end_date;

CREATE INDEX IF NOT EXISTS idx_goals_quarterly_cycles_goal_submission_end_date
    ON public.goals_quarterly_cycles USING btree
    (goal_submission_end_date ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
-- Index: idx_goals_quarterly_cycles_goal_submission_start_date

-- DROP INDEX IF EXISTS public.idx_goals_quarterly_cycles_goal_submission_start_date;

CREATE INDEX IF NOT EXISTS idx_goals_quarterly_cycles_goal_submission_start_date
    ON public.goals_quarterly_cycles USING btree
    (goal_submission_start_date ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
-- Index: idx_goals_quarterly_cycles_manager_review_end_date

-- DROP INDEX IF EXISTS public.idx_goals_quarterly_cycles_manager_review_end_date;

CREATE INDEX IF NOT EXISTS idx_goals_quarterly_cycles_manager_review_end_date
    ON public.goals_quarterly_cycles USING btree
    (manager_review_end_date ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
-- Index: idx_goals_quarterly_cycles_performance_cycle_id

-- DROP INDEX IF EXISTS public.idx_goals_quarterly_cycles_performance_cycle_id;

CREATE INDEX IF NOT EXISTS idx_goals_quarterly_cycles_performance_cycle_id
    ON public.goals_quarterly_cycles USING btree
    (performance_cycle_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
-- Index: idx_goals_quarterly_cycles_quarter

-- DROP INDEX IF EXISTS public.idx_goals_quarterly_cycles_quarter;

CREATE INDEX IF NOT EXISTS idx_goals_quarterly_cycles_quarter
    ON public.goals_quarterly_cycles USING btree
    (quarter ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
-- Index: idx_goals_quarterly_cycles_quarterly_cycle_id

-- DROP INDEX IF EXISTS public.idx_goals_quarterly_cycles_quarterly_cycle_id;

CREATE INDEX IF NOT EXISTS idx_goals_quarterly_cycles_quarterly_cycle_id
    ON public.goals_quarterly_cycles USING btree
    (quarterly_cycle_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
-- Index: idx_goals_quarterly_cycles_status

-- DROP INDEX IF EXISTS public.idx_goals_quarterly_cycles_status;

CREATE INDEX IF NOT EXISTS idx_goals_quarterly_cycles_status
    ON public.goals_quarterly_cycles USING btree
    (status ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
-- Index: idx_goals_quarterly_cycles_status_active

-- DROP INDEX IF EXISTS public.idx_goals_quarterly_cycles_status_active;

CREATE INDEX IF NOT EXISTS idx_goals_quarterly_cycles_status_active
    ON public.goals_quarterly_cycles USING btree
    (status ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default
    WHERE status = 'active'::cycle_status;


---kra_templates
CREATE TABLE IF NOT EXISTS public.kra_templates
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    title text COLLATE pg_catalog."default" NOT NULL,
    description text COLLATE pg_catalog."default",
    suggested_weight integer NOT NULL DEFAULT 25,
    department text COLLATE pg_catalog."default",
    grade text COLLATE pg_catalog."default",
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT kra_templates_pkey PRIMARY KEY (id),
    CONSTRAINT kra_templates_created_by_fkey FOREIGN KEY (created_by)
        REFERENCES public.profiles (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.kra_templates
    OWNER to postgres;


---Kpi_templates
CREATE TYPE metric_type AS ENUM (
  'number',
  'percentage',
  'milestone',
  'qualitative'
);

CREATE TABLE IF NOT EXISTS public.kpi_templates
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    kra_template_id uuid NOT NULL,
    title text COLLATE pg_catalog."default" NOT NULL,
    description text COLLATE pg_catalog."default",
    metric_type metric_type NOT NULL DEFAULT 'number'::metric_type,
    suggested_target text COLLATE pg_catalog."default",
    suggested_weight integer NOT NULL DEFAULT 50,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    calibration jsonb,
    CONSTRAINT kpi_templates_pkey PRIMARY KEY (id),
    CONSTRAINT kpi_templates_kra_template_id_fkey FOREIGN KEY (kra_template_id)
        REFERENCES public.kra_templates (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.kpi_templates
    OWNER to postgres;

COMMENT ON COLUMN public.kpi_templates.calibration
    IS 'JSONB array of calibration rules: [{"threshold": 120, "rating": 5}, {"threshold": 110, "rating": 4}, ...]. Thresholds are percentages relative to target.';


CREATE INDEX IF NOT EXISTS idx_kpi_templates_calibration
    ON public.kpi_templates USING gin
    (calibration)
    WITH (fastupdate=True, gin_pending_list_limit=2097151)
    TABLESPACE pg_default
    WHERE calibration IS NOT NULL;

------------------------------------------------------------------------------
--employee_quarter_transition

CREATE TYPE transition_type AS ENUM (
  'promotion',
  'project_change',
  'role_change'
);
CREATE TABLE IF NOT EXISTS public.employee_quarter_transitions
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL,
    cycle_id uuid NOT NULL,
    quarter integer NOT NULL,
    transition_type transition_type NOT NULL,
    transition_date date NOT NULL,
    old_manager_id uuid,
    new_manager_id uuid,
    old_department text COLLATE pg_catalog."default",
    new_department text COLLATE pg_catalog."default",
    old_project text COLLATE pg_catalog."default",
    new_project text COLLATE pg_catalog."default",
    old_grade text COLLATE pg_catalog."default",
    new_grade text COLLATE pg_catalog."default",
    old_period_closed boolean NOT NULL DEFAULT false,
    old_period_reviewed boolean NOT NULL DEFAULT false,
    new_period_goals_set boolean NOT NULL DEFAULT false,
    new_period_approved boolean NOT NULL DEFAULT false,
    created_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT employee_quarter_transitions_pkey PRIMARY KEY (id),
    CONSTRAINT employee_quarter_transitions_employee_id_cycle_id_quarter_key UNIQUE (employee_id, cycle_id, quarter),
    CONSTRAINT employee_quarter_transitions_created_by_fkey FOREIGN KEY (created_by)
        REFERENCES public.profiles (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT employee_quarter_transitions_cycle_id_fkey FOREIGN KEY (cycle_id)
        REFERENCES public.performance_cycles (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT employee_quarter_transitions_employee_id_fkey FOREIGN KEY (employee_id)
        REFERENCES public.employees (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT employee_quarter_transitions_new_manager_id_fkey FOREIGN KEY (new_manager_id)
        REFERENCES public.employees (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT employee_quarter_transitions_old_manager_id_fkey FOREIGN KEY (old_manager_id)
        REFERENCES public.employees (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT employee_quarter_transitions_quarter_check CHECK (quarter >= 1 AND quarter <= 4)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.employee_quarter_transitions
    OWNER to postgres;

COMMENT ON TABLE public.employee_quarter_transitions
    IS 'Tracks mid-quarter employee transitions (promotions, project changes, role changes)';


CREATE INDEX IF NOT EXISTS idx_employee_quarter_transitions_employee_cycle
    ON public.employee_quarter_transitions USING btree
    (employee_id ASC NULLS LAST, cycle_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;


CREATE INDEX IF NOT EXISTS idx_employee_quarter_transitions_quarter
    ON public.employee_quarter_transitions USING btree
    (quarter ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;


CREATE INDEX IF NOT EXISTS idx_employee_quarter_transitions_transition_date
    ON public.employee_quarter_transitions USING btree
    (transition_date ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

-----------------------------------------------------------------------------

--kras table
CREATE TYPE goal_status AS ENUM (
  'draft',
  'submitted',
  'approved',
  'returned',
  'locked'
);
CREATE TYPE period_type as ENUM(
'full_quarter',
'pre_transition',
'post_transition'
);
CREATE TABLE IF NOT EXISTS public.kras
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL,
    cycle_id uuid NOT NULL,
    title text COLLATE pg_catalog."default" NOT NULL,
    description text COLLATE pg_catalog."default",
    weight numeric NOT NULL,
    status goal_status NOT NULL DEFAULT 'draft'::goal_status,
    manager_comments text COLLATE pg_catalog."default",
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    quarter integer,
    kra_template_id uuid,
    period_type period_type DEFAULT 'full_quarter'::period_type,
    transition_id uuid,
    period_start_date date,
    period_end_date date,
    CONSTRAINT kras_pkey PRIMARY KEY (id),
    CONSTRAINT kras_cycle_id_fkey FOREIGN KEY (cycle_id)
        REFERENCES public.performance_cycles (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT kras_employee_id_fkey FOREIGN KEY (employee_id)
        REFERENCES public.employees (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT kras_kra_template_id_fkey FOREIGN KEY (kra_template_id)
        REFERENCES public.kra_templates (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT kras_transition_id_fkey FOREIGN KEY (transition_id)
        REFERENCES public.employee_quarter_transitions (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT kras_weight_check CHECK (weight > 0::numeric AND weight <= 100::numeric),
    CONSTRAINT kras_quarter_check CHECK (quarter >= 1 AND quarter <= 4)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.kras
    OWNER to postgres;

COMMENT ON COLUMN public.kras.kra_template_id
    IS 'Reference to the KRA template used to create this KRA. NULL if created as custom KRA.';

COMMENT ON COLUMN public.kras.period_type
    IS 'Identifies if KRA belongs to full quarter, pre-transition, or post-transition period';
-- Index: idx_kras_cycle_id

-- DROP INDEX IF EXISTS public.idx_kras_cycle_id;

CREATE INDEX IF NOT EXISTS idx_kras_cycle_id
    ON public.kras USING btree
    (cycle_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
-- Index: idx_kras_employee_id

-- DROP INDEX IF EXISTS public.idx_kras_employee_id;

CREATE INDEX IF NOT EXISTS idx_kras_employee_id
    ON public.kras USING btree
    (employee_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
-- Index: idx_kras_kra_template_id

-- DROP INDEX IF EXISTS public.idx_kras_kra_template_id;

CREATE INDEX IF NOT EXISTS idx_kras_kra_template_id
    ON public.kras USING btree
    (kra_template_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default
    WHERE kra_template_id IS NOT NULL;
-- Index: idx_kras_period_type

-- DROP INDEX IF EXISTS public.idx_kras_period_type;

CREATE INDEX IF NOT EXISTS idx_kras_period_type
    ON public.kras USING btree
    (period_type ASC NULLS LAST, transition_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
-- Index: idx_kras_quarter

-- DROP INDEX IF EXISTS public.idx_kras_quarter;

CREATE INDEX IF NOT EXISTS idx_kras_quarter
    ON public.kras USING btree
    (quarter ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
-- Index: idx_kras_transition_id

-- DROP INDEX IF EXISTS public.idx_kras_transition_id;

CREATE INDEX IF NOT EXISTS idx_kras_transition_id
    ON public.kras USING btree
    (transition_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
--------------------------------------------------------------------



----------------------------------------------------------------------------

---goals table


CREATE TYPE period_type AS ENUM (
  'full_quarter',
  'pre_transition',
  'post_transition'
);

CREATE TYPE goal_type AS ENUM (
  'kpi',
  'okr',
  'competency'
);

CREATE TABLE IF NOT EXISTS public.goals
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL,
    cycle_id uuid NOT NULL,
    kra_id uuid,
    title text COLLATE pg_catalog."default" NOT NULL,
    description text COLLATE pg_catalog."default",
    goal_type goal_type NOT NULL,
    metric_type metric_type NOT NULL,
    target_value text COLLATE pg_catalog."default",
    weight numeric(5,2) NOT NULL,
    due_date date,
    status goal_status NOT NULL DEFAULT 'draft'::goal_status,
    manager_comments text COLLATE pg_catalog."default",
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    quarter integer,
    calibration jsonb,
    kpi_template_id uuid,
    admin_override boolean NOT NULL DEFAULT false,
    admin_override_by uuid,
    admin_override_at timestamp with time zone,
    period_type period_type DEFAULT 'full_quarter'::period_type,
    transition_id uuid,
    period_start_date date,
    period_end_date date,
    CONSTRAINT goals_pkey PRIMARY KEY (id),
    CONSTRAINT goals_admin_override_by_fkey FOREIGN KEY (admin_override_by)
        REFERENCES public.profiles (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT goals_cycle_id_fkey FOREIGN KEY (cycle_id)
        REFERENCES public.performance_cycles (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT goals_employee_id_fkey FOREIGN KEY (employee_id)
        REFERENCES public.employees (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT goals_kpi_template_id_fkey FOREIGN KEY (kpi_template_id)
        REFERENCES public.kpi_templates (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT goals_kra_id_fkey FOREIGN KEY (kra_id)
        REFERENCES public.kras (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT goals_transition_id_fkey FOREIGN KEY (transition_id)
        REFERENCES public.employee_quarter_transitions (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT goals_weight_check CHECK (weight > 0::numeric AND weight <= 100::numeric),
    CONSTRAINT goals_quarter_check CHECK (quarter >= 1 AND quarter <= 4)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.goals
    OWNER to postgres;

COMMENT ON COLUMN public.goals.calibration
    IS 'JSONB array of calibration rules copied from template. Editable until manager approval, then locked.';

COMMENT ON COLUMN public.goals.kpi_template_id
    IS 'Reference to the KPI template used to create this KPI. NULL if created as custom KPI.';

COMMENT ON COLUMN public.goals.period_type
    IS 'Identifies if goal belongs to full quarter, pre-transition, or post-transition period';

CREATE INDEX IF NOT EXISTS idx_goals_admin_override
    ON public.goals USING btree
    (admin_override ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default
    WHERE admin_override = true;

CREATE INDEX IF NOT EXISTS idx_goals_admin_override_by
    ON public.goals USING btree
    (admin_override_by ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default
    WHERE admin_override_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_goals_calibration
    ON public.goals USING gin
    (calibration)
    WITH (fastupdate=True, gin_pending_list_limit=2097151)
    TABLESPACE pg_default
    WHERE calibration IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_goals_cycle_id
    ON public.goals USING btree
    (cycle_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_goals_employee_cycle_quarter_admin
    ON public.goals USING btree
    (employee_id ASC NULLS LAST, cycle_id ASC NULLS LAST, quarter ASC NULLS LAST, admin_override ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default
    WHERE admin_override = true;

CREATE INDEX IF NOT EXISTS idx_goals_employee_id
    ON public.goals USING btree
    (employee_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_goals_kpi_template_id
    ON public.goals USING btree
    (kpi_template_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default
    WHERE kpi_template_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_goals_kra_id
    ON public.goals USING btree
    (kra_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_goals_period_type
    ON public.goals USING btree
    (period_type ASC NULLS LAST, transition_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_goals_quarter
    ON public.goals USING btree
    (quarter ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_goals_transition_id
    ON public.goals USING btree
    (transition_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

--------------------------------------------------------------------------
--quarterly_self_reviews
CREATE TYPE evaluation_status AS ENUM (
  'pending',
  'in_progress',
  'submitted',
  'calibrated',
  'released'
);

CREATE TABLE IF NOT EXISTS public.quarterly_self_reviews
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL,
    cycle_id uuid NOT NULL,
    quarter integer NOT NULL,
    overall_comments text COLLATE pg_catalog."default",
    status evaluation_status NOT NULL DEFAULT 'pending'::evaluation_status,
    submitted_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    overall_rating double precision,
    admin_override boolean NOT NULL DEFAULT false,
    admin_override_by uuid,
    admin_override_at timestamp with time zone,
    period_type period_type DEFAULT 'full_quarter'::period_type,
    transition_id uuid,
    period_start_date date,
    period_end_date date,
    CONSTRAINT quarterly_self_reviews_pkey PRIMARY KEY (id),
    CONSTRAINT quarterly_self_reviews_admin_override_by_fkey FOREIGN KEY (admin_override_by)
        REFERENCES public.profiles (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT quarterly_self_reviews_transition_id_fkey FOREIGN KEY (transition_id)
        REFERENCES public.employee_quarter_transitions (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT quarterly_self_reviews_overall_rating_check CHECK (overall_rating >= 1::double precision AND overall_rating <= 5::double precision)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.quarterly_self_reviews
    OWNER to postgres;

COMMENT ON COLUMN public.quarterly_self_reviews.period_type
    IS 'Identifies if review is for full quarter, pre-transition, or post-transition period';
-- Index: idx_quarterly_self_reviews_admin_override

-- DROP INDEX IF EXISTS public.idx_quarterly_self_reviews_admin_override;

CREATE INDEX IF NOT EXISTS idx_quarterly_self_reviews_admin_override
    ON public.quarterly_self_reviews USING btree
    (admin_override ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default
    WHERE admin_override = true;
-- Index: idx_quarterly_self_reviews_admin_override_by

-- DROP INDEX IF EXISTS public.idx_quarterly_self_reviews_admin_override_by;

CREATE INDEX IF NOT EXISTS idx_quarterly_self_reviews_admin_override_by
    ON public.quarterly_self_reviews USING btree
    (admin_override_by ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default
    WHERE admin_override_by IS NOT NULL;
-- Index: idx_quarterly_self_reviews_employee_cycle_quarter_admin

-- DROP INDEX IF EXISTS public.idx_quarterly_self_reviews_employee_cycle_quarter_admin;

CREATE INDEX IF NOT EXISTS idx_quarterly_self_reviews_employee_cycle_quarter_admin
    ON public.quarterly_self_reviews USING btree
    (employee_id ASC NULLS LAST, cycle_id ASC NULLS LAST, quarter ASC NULLS LAST, admin_override ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default
    WHERE admin_override = true;
-- Index: idx_quarterly_self_reviews_period_type

-- DROP INDEX IF EXISTS public.idx_quarterly_self_reviews_period_type;

CREATE INDEX IF NOT EXISTS idx_quarterly_self_reviews_period_type
    ON public.quarterly_self_reviews USING btree
    (period_type ASC NULLS LAST, transition_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
-- Index: quarterly_self_reviews_employee_cycle_quarter_period_idx

-- DROP INDEX IF EXISTS public.quarterly_self_reviews_employee_cycle_quarter_period_idx;

CREATE UNIQUE INDEX IF NOT EXISTS quarterly_self_reviews_employee_cycle_quarter_period_idx
    ON public.quarterly_self_reviews USING btree
    (employee_id ASC NULLS LAST, cycle_id ASC NULLS LAST, quarter ASC NULLS LAST, period_type ASC NULLS LAST, COALESCE(transition_id, '00000000-0000-0000-0000-000000000000'::uuid) ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

--------------------------------------------------------------------------
--goal_self_ratings
CREATE TABLE IF NOT EXISTS public.goal_self_ratings
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    quarterly_review_id uuid NOT NULL,
    goal_id uuid NOT NULL,
    achievement text COLLATE pg_catalog."default",
    self_rating integer,
    evidence text COLLATE pg_catalog."default",
    achieved_value numeric,
    target_value numeric,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT goal_self_ratings_pkey PRIMARY KEY (id),
    CONSTRAINT goal_self_ratings_quarterly_review_id_goal_id_key UNIQUE (quarterly_review_id, goal_id),
    CONSTRAINT goal_self_ratings_goal_id_fkey FOREIGN KEY (goal_id)
        REFERENCES public.goals (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT goal_self_ratings_quarterly_review_id_fkey FOREIGN KEY (quarterly_review_id)
        REFERENCES public.quarterly_self_reviews (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT goal_self_ratings_self_rating_check CHECK (self_rating >= 1 AND self_rating <= 5)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.goal_self_ratings
    OWNER to postgres;
----------------------------------------------------------------------------------
--quarterly_manager_review

CREATE TABLE IF NOT EXISTS public.quarterly_manager_reviews
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL,
    cycle_id uuid NOT NULL,
    quarter integer NOT NULL,
    reviewer_id uuid NOT NULL,
    overall_comments text COLLATE pg_catalog."default",
    guidance text COLLATE pg_catalog."default",
    calculated_overall_rating numeric(3,2),
    status evaluation_status NOT NULL DEFAULT 'pending'::evaluation_status,
    approved_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    hr_approved_at timestamp with time zone,
    hr_approved_by uuid,
    released_at timestamp with time zone,
    employee_acknowledged_at timestamp with time zone,
    employee_rejected_at timestamp with time zone,
    hr_rejection_reason text COLLATE pg_catalog."default",
    admin_override boolean NOT NULL DEFAULT false,
    admin_override_by uuid,
    admin_override_at timestamp with time zone,
    period_type period_type DEFAULT 'full_quarter'::period_type,
    transition_id uuid,
    period_start_date date,
    period_end_date date,
    is_old_manager_review boolean DEFAULT false,
    CONSTRAINT quarterly_manager_reviews_pkey PRIMARY KEY (id),
    CONSTRAINT quarterly_manager_reviews_admin_override_by_fkey FOREIGN KEY (admin_override_by)
        REFERENCES public.profiles (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT quarterly_manager_reviews_transition_id_fkey FOREIGN KEY (transition_id)
        REFERENCES public.employee_quarter_transitions (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.quarterly_manager_reviews
    OWNER to postgres;

COMMENT ON COLUMN public.quarterly_manager_reviews.hr_approved_at
    IS 'Timestamp when HR approved the manager review. Backfilled from normalized_ratings.updated_at for historical PUBLISHED ratings.';

COMMENT ON COLUMN public.quarterly_manager_reviews.hr_approved_by
    IS 'UUID of HR user who approved the review. For historical data, may be NULL or set to first HR admin found.';

COMMENT ON COLUMN public.quarterly_manager_reviews.released_at
    IS 'Timestamp when HR published/released the rating to employee. Backfilled from normalized_ratings.updated_at for historical PUBLISHED ratings.';

COMMENT ON COLUMN public.quarterly_manager_reviews.period_type
    IS 'Identifies if review is for full quarter, pre-transition, or post-transition period';

COMMENT ON COLUMN public.quarterly_manager_reviews.is_old_manager_review
    IS 'Flag to identify if this is the old manager reviewing pre-transition period';


CREATE INDEX IF NOT EXISTS idx_quarterly_manager_reviews_admin_override
    ON public.quarterly_manager_reviews USING btree
    (admin_override ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default
    WHERE admin_override = true;


CREATE INDEX IF NOT EXISTS idx_quarterly_manager_reviews_admin_override_by
    ON public.quarterly_manager_reviews USING btree
    (admin_override_by ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default
    WHERE admin_override_by IS NOT NULL;


CREATE INDEX IF NOT EXISTS idx_quarterly_manager_reviews_employee_cycle_quarter_admin
    ON public.quarterly_manager_reviews USING btree
    (employee_id ASC NULLS LAST, cycle_id ASC NULLS LAST, quarter ASC NULLS LAST, admin_override ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default
    WHERE admin_override = true;


CREATE INDEX IF NOT EXISTS idx_quarterly_manager_reviews_hr_approved
    ON public.quarterly_manager_reviews USING btree
    (employee_id ASC NULLS LAST, cycle_id ASC NULLS LAST, quarter ASC NULLS LAST, hr_approved_at ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default
    WHERE hr_approved_at IS NOT NULL;


CREATE INDEX IF NOT EXISTS idx_quarterly_manager_reviews_period_type
    ON public.quarterly_manager_reviews USING btree
    (period_type ASC NULLS LAST, transition_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

CREATE UNIQUE INDEX IF NOT EXISTS quarterly_manager_reviews_employee_cycle_quarter_period_idx
    ON public.quarterly_manager_reviews USING btree
    (employee_id ASC NULLS LAST, cycle_id ASC NULLS LAST, quarter ASC NULLS LAST, period_type ASC NULLS LAST, COALESCE(transition_id, '00000000-0000-0000-0000-000000000000'::uuid) ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
--------------------------------------------------------------------------------------------
---quarterly_kpi_manger_feedback

CREATE TABLE IF NOT EXISTS public.quarterly_kpi_manager_feedback
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    manager_review_id uuid NOT NULL,
    goal_id uuid NOT NULL,
    rating integer,
    comments text COLLATE pg_catalog."default",
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    progress_percentage integer,
    CONSTRAINT quarterly_kpi_manager_feedback_pkey PRIMARY KEY (id),
    CONSTRAINT quarterly_kpi_manager_feedback_manager_review_id_goal_id_key UNIQUE (manager_review_id, goal_id),
    CONSTRAINT quarterly_kpi_manager_feedback_manager_review_id_fkey FOREIGN KEY (manager_review_id)
        REFERENCES public.quarterly_manager_reviews (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.quarterly_kpi_manager_feedback
    OWNER to postgres;

--------------------------------------------------------------------------------------
--departments
CREATE TABLE IF NOT EXISTS public.departments
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text COLLATE pg_catalog."default" NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT departments_pkey PRIMARY KEY (id),
    CONSTRAINT departments_name_key UNIQUE (name)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.departments
    OWNER to postgres;
-----------------------------------------------------------------------------------------------
--rating_rejections
CREATE TABLE IF NOT EXISTS public.rating_rejections
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL,
    cycle_id uuid NOT NULL,
    quarter integer NOT NULL,
    manager_review_id uuid NOT NULL,
    rejection_reason text COLLATE pg_catalog."default" NOT NULL,
    status text COLLATE pg_catalog."default" NOT NULL DEFAULT 'pending'::text,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT rating_rejections_pkey PRIMARY KEY (id),
    CONSTRAINT rating_rejections_employee_id_cycle_id_quarter_key UNIQUE (employee_id, cycle_id, quarter),
    CONSTRAINT rating_rejections_cycle_id_fkey FOREIGN KEY (cycle_id)
        REFERENCES public.performance_cycles (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT rating_rejections_employee_id_fkey FOREIGN KEY (employee_id)
        REFERENCES public.employees (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT rating_rejections_manager_review_id_fkey FOREIGN KEY (manager_review_id)
        REFERENCES public.quarterly_manager_reviews (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT rating_rejections_status_check CHECK (status = ANY (ARRAY['pending'::text, 'resolved'::text, 'dismissed'::text]))
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.rating_rejections
    OWNER to postgres;
-- Index: idx_rating_rejections_cycle_quarter

-- DROP INDEX IF EXISTS public.idx_rating_rejections_cycle_quarter;

CREATE INDEX IF NOT EXISTS idx_rating_rejections_cycle_quarter
    ON public.rating_rejections USING btree
    (cycle_id ASC NULLS LAST, quarter ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
-- Index: idx_rating_rejections_employee

-- DROP INDEX IF EXISTS public.idx_rating_rejections_employee;

CREATE INDEX IF NOT EXISTS idx_rating_rejections_employee
    ON public.rating_rejections USING btree
    (employee_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
-- Index: idx_rating_rejections_status

-- DROP INDEX IF EXISTS public.idx_rating_rejections_status;

CREATE INDEX IF NOT EXISTS idx_rating_rejections_status
    ON public.rating_rejections USING btree
    (status COLLATE pg_catalog."default" ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

---------------------------------------------------------
--quarterly_final_ratings
CREATE TABLE IF NOT EXISTS public.quarterly_final_ratings
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL,
    cycle_id uuid NOT NULL,
    quarter integer NOT NULL,
    transition_id uuid,
    pre_transition_rating numeric(5,3),
    post_transition_rating numeric(5,3),
    pre_transition_days integer,
    post_transition_days integer,
    final_quarterly_rating numeric(5,3) NOT NULL,
    calculation_method text COLLATE pg_catalog."default" NOT NULL,
    is_final boolean NOT NULL DEFAULT false,
    calculated_at timestamp with time zone NOT NULL DEFAULT now(),
    calculated_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT quarterly_final_ratings_pkey PRIMARY KEY (id),
    CONSTRAINT quarterly_final_ratings_employee_id_cycle_id_quarter_key UNIQUE (employee_id, cycle_id, quarter),
    CONSTRAINT quarterly_final_ratings_calculated_by_fkey FOREIGN KEY (calculated_by)
        REFERENCES public.profiles (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT quarterly_final_ratings_cycle_id_fkey FOREIGN KEY (cycle_id)
        REFERENCES public.performance_cycles (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT quarterly_final_ratings_employee_id_fkey FOREIGN KEY (employee_id)
        REFERENCES public.employees (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT quarterly_final_ratings_transition_id_fkey FOREIGN KEY (transition_id)
        REFERENCES public.employee_quarter_transitions (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT quarterly_final_ratings_calculation_method_check CHECK (calculation_method = ANY (ARRAY['simple_average'::text, 'time_weighted'::text])),
    CONSTRAINT quarterly_final_ratings_quarter_check CHECK (quarter >= 1 AND quarter <= 4)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.quarterly_final_ratings
    OWNER to postgres;

COMMENT ON TABLE public.quarterly_final_ratings
    IS 'Stores final combined quarterly rating after merging pre and post-transition ratings';


CREATE INDEX IF NOT EXISTS idx_quarterly_final_ratings_employee_cycle
    ON public.quarterly_final_ratings USING btree
    (employee_id ASC NULLS LAST, cycle_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;


CREATE INDEX IF NOT EXISTS idx_quarterly_final_ratings_transition
    ON public.quarterly_final_ratings USING btree
    (transition_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
----------------------------------------------------------------------------------------------
--manager_evaluations
CREATE TABLE IF NOT EXISTS public.manager_evaluations
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL,
    cycle_id uuid NOT NULL,
    evaluator_id uuid NOT NULL,
    overall_rating integer,
    potential_rating integer,
    overall_comments text COLLATE pg_catalog."default",
    development_recommendations text COLLATE pg_catalog."default",
    q1_rating numeric(3,2),
    q2_rating numeric(3,2),
    q3_rating numeric(3,2),
    q4_rating numeric(3,2),
    calculated_overall_rating numeric(3,2),
    status evaluation_status NOT NULL DEFAULT 'pending'::evaluation_status,
    submitted_at timestamp with time zone,
    released_at timestamp with time zone,
    acknowledged_at timestamp with time zone,
    acknowledgment_comments text COLLATE pg_catalog."default",
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    q1_pre_transition_rating numeric(5,3),
    q1_post_transition_rating numeric(5,3),
    q1_transition_id uuid,
    q2_pre_transition_rating numeric(5,3),
    q2_post_transition_rating numeric(5,3),
    q2_transition_id uuid,
    q3_pre_transition_rating numeric(5,3),
    q3_post_transition_rating numeric(5,3),
    q3_transition_id uuid,
    q4_pre_transition_rating numeric(5,3),
    q4_post_transition_rating numeric(5,3),
    q4_transition_id uuid,
    CONSTRAINT manager_evaluations_pkey PRIMARY KEY (id),
    CONSTRAINT manager_evaluations_employee_id_cycle_id_key UNIQUE (employee_id, cycle_id),
    CONSTRAINT manager_evaluations_cycle_id_fkey FOREIGN KEY (cycle_id)
        REFERENCES public.performance_cycles (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT manager_evaluations_employee_id_fkey FOREIGN KEY (employee_id)
        REFERENCES public.employees (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT manager_evaluations_evaluator_id_fkey FOREIGN KEY (evaluator_id)
        REFERENCES public.employees (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT manager_evaluations_q1_transition_id_fkey FOREIGN KEY (q1_transition_id)
        REFERENCES public.employee_quarter_transitions (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT manager_evaluations_q2_transition_id_fkey FOREIGN KEY (q2_transition_id)
        REFERENCES public.employee_quarter_transitions (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT manager_evaluations_q3_transition_id_fkey FOREIGN KEY (q3_transition_id)
        REFERENCES public.employee_quarter_transitions (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT manager_evaluations_q4_transition_id_fkey FOREIGN KEY (q4_transition_id)
        REFERENCES public.employee_quarter_transitions (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT manager_evaluations_overall_rating_check CHECK (overall_rating >= 1 AND overall_rating <= 5),
    CONSTRAINT manager_evaluations_potential_rating_check CHECK (potential_rating >= 1 AND potential_rating <= 3)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.manager_evaluations
    OWNER to postgres;


CREATE INDEX IF NOT EXISTS idx_manager_evaluations_employee_cycle
    ON public.manager_evaluations USING btree
    (employee_id ASC NULLS LAST, cycle_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

--------------------------------------------------------------------------------------
--late_submission_permissions
CREATE TABLE IF NOT EXISTS public.late_submission_permissions
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    cycle_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    granted_by uuid NOT NULL,
    granted_at timestamp with time zone NOT NULL DEFAULT now(),
    expires_at timestamp with time zone,
    reason text COLLATE pg_catalog."default",
    revoked_at timestamp with time zone,
    quarter integer,
    CONSTRAINT late_submission_permissions_pkey PRIMARY KEY (id),
    CONSTRAINT late_submission_permissions_cycle_id_fkey FOREIGN KEY (cycle_id)
        REFERENCES public.performance_cycles (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT late_submission_permissions_employee_id_fkey FOREIGN KEY (employee_id)
        REFERENCES public.employees (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT late_submission_permissions_quarter_check CHECK (quarter >= 1 AND quarter <= 4)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.late_submission_permissions
    OWNER to postgres;

COMMENT ON COLUMN public.late_submission_permissions.quarter
    IS 'Quarter number (1-4). NULL means permission applies to all quarters.';

CREATE UNIQUE INDEX IF NOT EXISTS late_submission_permissions_cycle_employee_quarter_idx
    ON public.late_submission_permissions USING btree
    (cycle_id ASC NULLS LAST, employee_id ASC NULLS LAST, COALESCE(quarter, 0) ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS late_submission_permissions_quarter_idx
    ON public.late_submission_permissions USING btree
    (quarter ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

---------------------------------------------------------------------
--normalization_rating
CREATE TYPE normalized_rating_status AS ENUM (
  'DRAFT',
  'SENT_TO_MANAGER',
  'ACCEPTED',
  'REJECTED',
  'PUBLISHED'
);

CREATE TABLE IF NOT EXISTS public.normalized_ratings
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL,
    manager_id uuid NOT NULL,
    performance_cycle_id uuid NOT NULL,
    quarter integer NOT NULL,
    raw_rating numeric(3,2) NOT NULL,
    boxcox_manager_level_rating numeric(3,2),
    boxcox_grade_level_rating numeric(3,2),
    final_normalized_rating numeric(3,2),
    status normalized_rating_status NOT NULL DEFAULT 'DRAFT'::normalized_rating_status,
    updated_by_hr uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    normalized_kpi_ratings jsonb,
    normalized_kra_ratings jsonb,
    raw_kpi_ratings jsonb,
    raw_kra_ratings jsonb,
    calibrated_rating integer,
    CONSTRAINT normalized_ratings_pkey PRIMARY KEY (id),
    CONSTRAINT normalized_ratings_employee_id_fkey FOREIGN KEY (employee_id)
        REFERENCES public.employees (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT normalized_ratings_manager_id_fkey FOREIGN KEY (manager_id)
        REFERENCES public.employees (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT normalized_ratings_performance_cycle_id_fkey FOREIGN KEY (performance_cycle_id)
        REFERENCES public.performance_cycles (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT normalized_ratings_updated_by_hr_fkey FOREIGN KEY (updated_by_hr)
        REFERENCES public.profiles (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT normalized_ratings_quarter_check CHECK (quarter >= 1 AND quarter <= 4),
    CONSTRAINT normalized_ratings_calibrated_rating_check CHECK (calibrated_rating >= 1 AND calibrated_rating <= 5)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.normalized_ratings
    OWNER to postgres;

COMMENT ON TABLE public.normalized_ratings
    IS 'Stores Box-Cox normalized ratings with HR-Manager validation workflow';

COMMENT ON COLUMN public.normalized_ratings.raw_rating
    IS 'Original manager-submitted rating';

COMMENT ON COLUMN public.normalized_ratings.boxcox_manager_level_rating
    IS 'Normalized rating within manager scope';

COMMENT ON COLUMN public.normalized_ratings.boxcox_grade_level_rating
    IS 'Normalized rating within grade/band scope';

COMMENT ON COLUMN public.normalized_ratings.final_normalized_rating
    IS 'Combined normalized rating (weighted average)';

COMMENT ON COLUMN public.normalized_ratings.status
    IS 'Workflow status: DRAFT -> SENT_TO_MANAGER -> ACCEPTED/REJECTED -> PUBLISHED';

COMMENT ON COLUMN public.normalized_ratings.normalized_kpi_ratings
    IS 'JSONB array of normalized KPI ratings: [{"goal_id": "uuid", "raw_rating": 4.0, "normalized_manager": 3.8, "normalized_grade": 3.9, "final_normalized": 3.85}]';

COMMENT ON COLUMN public.normalized_ratings.normalized_kra_ratings
    IS 'JSONB array of normalized KRA ratings: [{"kra_id": "uuid", "raw_rating": 4.2, "normalized_manager": 4.0, "normalized_grade": 4.1, "final_normalized": 4.05}]';

COMMENT ON COLUMN public.normalized_ratings.raw_kpi_ratings
    IS 'JSONB array of raw KPI ratings before normalization: [{"goal_id": "uuid", "rating": 4.0, "weight": 30}]';

COMMENT ON COLUMN public.normalized_ratings.raw_kra_ratings
    IS 'JSONB array of raw KRA ratings (calculated from raw KPIs): [{"kra_id": "uuid", "rating": 4.2, "weight": 40}]';

COMMENT ON COLUMN public.normalized_ratings.calibrated_rating
    IS 'Bell curve calibrated rating (1-5) based on final_normalized_rating, applied per grade. Only set after calibration phase. Quotas are configurable via default_calibration_quotas table.';


CREATE INDEX IF NOT EXISTS idx_normalized_ratings_calibrated_rating
    ON public.normalized_ratings USING btree
    (calibrated_rating ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default
    WHERE calibrated_rating IS NOT NULL;


CREATE INDEX IF NOT EXISTS idx_normalized_ratings_cycle_quarter_status
    ON public.normalized_ratings USING btree
    (performance_cycle_id ASC NULLS LAST, quarter ASC NULLS LAST, status ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;


CREATE INDEX IF NOT EXISTS idx_normalized_ratings_employee
    ON public.normalized_ratings USING btree
    (employee_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;


CREATE INDEX IF NOT EXISTS idx_normalized_ratings_kpi_ratings
    ON public.normalized_ratings USING gin
    (normalized_kpi_ratings)
    WITH (fastupdate=True, gin_pending_list_limit=2097151)
    TABLESPACE pg_default;


CREATE INDEX IF NOT EXISTS idx_normalized_ratings_kra_ratings
    ON public.normalized_ratings USING gin
    (normalized_kra_ratings)
    WITH (fastupdate=True, gin_pending_list_limit=2097151)
    TABLESPACE pg_default;


CREATE INDEX IF NOT EXISTS idx_normalized_ratings_manager_quarter
    ON public.normalized_ratings USING btree
    (manager_id ASC NULLS LAST, quarter ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;


CREATE INDEX IF NOT EXISTS idx_normalized_ratings_status
    ON public.normalized_ratings USING btree
    (status ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

--------------------------------------------------------------------------------
--normalized_runs
CREATE TABLE IF NOT EXISTS public.normalization_runs
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    performance_cycle_id uuid NOT NULL,
    quarter integer NOT NULL,
    run_by uuid,
    run_at timestamp with time zone NOT NULL DEFAULT now(),
    total_employees integer NOT NULL DEFAULT 0,
    processed_count integer NOT NULL DEFAULT 0,
    skipped_count integer NOT NULL DEFAULT 0,
    manager_weight numeric(3,2) DEFAULT 0.5,
    grade_weight numeric(3,2) DEFAULT 0.5,
    min_group_size integer DEFAULT 3,
    use_winsorization boolean DEFAULT true,
    winsorization_percentile_low numeric(3,1) DEFAULT 5.0,
    winsorization_percentile_high numeric(3,1) DEFAULT 95.0,
    max_change_from_raw numeric(3,2) DEFAULT 2.0,
    avg_raw_rating numeric(5,3),
    avg_normalized_rating numeric(5,3),
    min_raw_rating numeric(5,3),
    max_raw_rating numeric(5,3),
    min_normalized_rating numeric(5,3),
    max_normalized_rating numeric(5,3),
    notes text COLLATE pg_catalog."default",
    CONSTRAINT normalization_runs_pkey PRIMARY KEY (id),
    CONSTRAINT normalization_runs_performance_cycle_id_fkey FOREIGN KEY (performance_cycle_id)
        REFERENCES public.performance_cycles (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT normalization_runs_run_by_fkey FOREIGN KEY (run_by)
        REFERENCES public.profiles (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT normalization_runs_quarter_check CHECK (quarter >= 1 AND quarter <= 4)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.normalization_runs
    OWNER to postgres;

COMMENT ON TABLE public.normalization_runs
    IS 'Audit trail for normalization runs with parameters and results';

COMMENT ON COLUMN public.normalization_runs.min_group_size
    IS 'Minimum group size required for full normalization (default 3)';

COMMENT ON COLUMN public.normalization_runs.use_winsorization
    IS 'Whether percentile clipping was applied to reduce outlier impact';

COMMENT ON COLUMN public.normalization_runs.max_change_from_raw
    IS 'Maximum allowed change from raw rating (safeguard)';
-- Index: idx_normalization_runs_cycle_quarter

-- DROP INDEX IF EXISTS public.idx_normalization_runs_cycle_quarter;

CREATE INDEX IF NOT EXISTS idx_normalization_runs_cycle_quarter
    ON public.normalization_runs USING btree
    (performance_cycle_id ASC NULLS LAST, quarter ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
-- Index: idx_normalization_runs_run_at

-- DROP INDEX IF EXISTS public.idx_normalization_runs_run_at;

CREATE INDEX IF NOT EXISTS idx_normalization_runs_run_at
    ON public.normalization_runs USING btree
    (run_at DESC NULLS FIRST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;

-----------------------------------------------------------------------------------
--calibration_settings

CREATE TABLE IF NOT EXISTS public.calibration_settings
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    is_enabled boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT calibration_settings_pkey PRIMARY KEY (id)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.calibration_settings
    OWNER to postgres;

------------------------------------------------------------------------------------------
--grades

CREATE TABLE IF NOT EXISTS public.grades
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text COLLATE pg_catalog."default" NOT NULL,
    level integer,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT grades_pkey PRIMARY KEY (id),
    CONSTRAINT grades_name_key UNIQUE (name)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.grades
    OWNER to postgres;

---------------------------------------------------------------------------
--manager_history
CREATE TABLE IF NOT EXISTS public.manager_history
(
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL,
    old_manager_id uuid,
    new_manager_id uuid,
    effective_date date NOT NULL,
    changed_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    transition_id uuid,
    CONSTRAINT manager_history_pkey PRIMARY KEY (id),
    CONSTRAINT manager_history_changed_by_fkey FOREIGN KEY (changed_by)
        REFERENCES public.profiles (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT manager_history_employee_id_fkey FOREIGN KEY (employee_id)
        REFERENCES public.employees (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT manager_history_new_manager_id_fkey FOREIGN KEY (new_manager_id)
        REFERENCES public.employees (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT manager_history_old_manager_id_fkey FOREIGN KEY (old_manager_id)
        REFERENCES public.employees (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL,
    CONSTRAINT manager_history_transition_id_fkey FOREIGN KEY (transition_id)
        REFERENCES public.employee_quarter_transitions (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE SET NULL
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.manager_history
    OWNER to postgres;

COMMENT ON COLUMN public.manager_history.transition_id
    IS 'Direct reference to employee_quarter_transitions. Links manager change to specific transition record.';
-- Index: idx_manager_history_employee_transition

-- DROP INDEX IF EXISTS public.idx_manager_history_employee_transition;

CREATE INDEX IF NOT EXISTS idx_manager_history_employee_transition
    ON public.manager_history USING btree
    (employee_id ASC NULLS LAST, transition_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
-- Index: idx_manager_history_transition_id

-- DROP INDEX IF EXISTS public.idx_manager_history_transition_id;

CREATE INDEX IF NOT EXISTS idx_manager_history_transition_id
    ON public.manager_history USING btree
    (transition_id ASC NULLS LAST)
    WITH (fillfactor=100, deduplicate_items=True)
    TABLESPACE pg_default;
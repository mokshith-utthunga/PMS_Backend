-- Migration: Add rejection_documents column to kra_kpi_rejections table
-- This allows managers to upload supporting documents (PDF, Excel) when rejecting KRAs/KPIs

ALTER TABLE public.kra_kpi_rejections
ADD COLUMN IF NOT EXISTS rejection_documents TEXT;

COMMENT ON COLUMN public.kra_kpi_rejections.rejection_documents IS 
    'JSON array of file paths for rejection supporting documents (PDF, Excel files) uploaded by manager. Stored in SharePoint.';

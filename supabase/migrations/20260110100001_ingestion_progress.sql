-- Add progress tracking columns to lead_ingestions
alter table public.lead_ingestions
  add column if not exists status text not null default 'completed',
  add column if not exists storage_path text,
  add column if not exists trigger_run_id text,
  add column if not exists total_rows integer,
  add column if not exists processed_rows integer default 0,
  add column if not exists lead_count integer default 0,
  add column if not exists company_count integer default 0,
  add column if not exists skipped_count integer default 0,
  add column if not exists error_message text,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz;

-- Add check constraint for status
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ingestion_status_check'
  ) then
    alter table public.lead_ingestions
      add constraint ingestion_status_check
      check (status in ('pending', 'uploading', 'processing', 'completed', 'failed'));
  end if;
end $$;

-- Index for status queries
create index if not exists lead_ingestions_status_idx
  on public.lead_ingestions (status);

-- Index for trigger run lookups
create index if not exists lead_ingestions_trigger_run_idx
  on public.lead_ingestions (trigger_run_id);

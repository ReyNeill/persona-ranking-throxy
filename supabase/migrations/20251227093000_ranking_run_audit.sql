alter table public.ranking_runs
  add column if not exists completed_at timestamptz,
  add column if not exists error_message text;

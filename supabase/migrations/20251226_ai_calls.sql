create table if not exists public.ai_calls (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.ranking_runs(id) on delete cascade,
  provider text not null,
  model text,
  operation text not null,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  documents_count integer,
  cost_usd numeric,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_calls_run_id_idx on public.ai_calls (run_id);
create index if not exists ai_calls_created_at_idx on public.ai_calls (created_at desc);

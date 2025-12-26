create extension if not exists "pgcrypto";

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_normalized text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists companies_name_normalized_idx
  on public.companies (name_normalized);

create table if not exists public.lead_ingestions (
  id uuid primary key default gen_random_uuid(),
  source text,
  filename text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  ingestion_id uuid references public.lead_ingestions(id) on delete set null,
  full_name text,
  title text,
  email text,
  linkedin_url text,
  data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists leads_company_id_idx on public.leads (company_id);
create index if not exists leads_ingestion_id_idx on public.leads (ingestion_id);

create table if not exists public.personas (
  id uuid primary key default gen_random_uuid(),
  name text,
  spec text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.ranking_runs (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas(id) on delete cascade,
  ingestion_id uuid references public.lead_ingestions(id) on delete set null,
  status text not null default 'completed',
  top_n integer not null default 3,
  min_score numeric not null default 0.4,
  model text,
  provider text,
  created_at timestamptz not null default now()
);

create index if not exists ranking_runs_created_at_idx on public.ranking_runs (created_at desc);

create table if not exists public.lead_rankings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ranking_runs(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  score numeric,
  relevance text,
  rank integer,
  selected boolean not null default false,
  reason text,
  created_at timestamptz not null default now(),
  unique (run_id, lead_id)
);

create index if not exists lead_rankings_company_idx on public.lead_rankings (company_id);
create index if not exists lead_rankings_run_idx on public.lead_rankings (run_id);

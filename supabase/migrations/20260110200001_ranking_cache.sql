-- Cache for ranking results to avoid redundant LLM calls
create table if not exists public.ranking_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  persona_hash text not null,
  results jsonb not null,
  hit_count integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

-- Unique constraint on cache key + company
create unique index if not exists ranking_cache_key_company_idx
  on public.ranking_cache (cache_key, company_id);

-- Index for cleanup of expired entries
create index if not exists ranking_cache_expires_idx
  on public.ranking_cache (expires_at);

-- Index for cache lookups
create index if not exists ranking_cache_lookup_idx
  on public.ranking_cache (persona_hash, company_id);

-- Function to clean expired cache entries (run periodically)
create or replace function clean_expired_ranking_cache()
returns integer as $$
declare
  deleted_count integer;
begin
  delete from public.ranking_cache where expires_at < now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$ language plpgsql;

comment on table public.ranking_cache is
  'Caches ranking results by persona+leads hash to avoid redundant LLM calls for identical inputs';

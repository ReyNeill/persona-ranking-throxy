create table if not exists public.prompt_leaderboards (
  id text primary key default 'active',
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.prompt_leaderboards (id, data)
values ('active', '{"objective": null, "k": null, "updatedAt": null, "entries": []}')
on conflict (id) do nothing;

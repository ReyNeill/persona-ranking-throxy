create table if not exists public.rate_limits (
  key text primary key,
  count integer not null,
  reset_time timestamptz not null
);

create or replace function public.check_rate_limit(
  p_key text,
  p_window_ms integer
)
returns table (count integer, reset_time timestamptz)
language sql
as $$
  insert into public.rate_limits as rl (key, count, reset_time)
  values (p_key, 1, now() + (p_window_ms * interval '1 millisecond'))
  on conflict (key) do update
    set count = case
      when rl.reset_time < now() then 1
      else rl.count + 1
    end,
    reset_time = case
      when rl.reset_time < now() then now() + (p_window_ms * interval '1 millisecond')
      else rl.reset_time
    end
  returning count, reset_time;
$$;

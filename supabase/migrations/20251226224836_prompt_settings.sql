create table if not exists public.prompt_settings (
  id text primary key default 'active',
  persona_query_prompt text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.prompt_settings (id, persona_query_prompt)
values (
  'active',
  $prompt$
You are converting a detailed persona specification into a concise, single-paragraph search query for outbound sales. Using the information in {{persona_spec}}, write a query that:
- Clearly states the required function (e.g., sales, business-development, growth) and seniority level (e.g., director, VP, C-level, founder).
- Includes any essential title keywords, industry, geography, or experience descriptors.
- Lists explicit disqualifiers for any function, seniority, role, or department that would make a contact unsuitable (e.g., revenue-operations, SDR, investor, CTO if not specified).
Return only the final query text, no bullets, headings, markdown, or additional commentary.
$prompt$
)
on conflict (id)
do update set
  persona_query_prompt = excluded.persona_query_prompt,
  updated_at = now();

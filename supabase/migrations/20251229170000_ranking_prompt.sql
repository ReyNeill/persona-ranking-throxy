alter table public.prompt_settings
  add column if not exists ranking_prompt text;

update public.prompt_settings
set
  ranking_prompt = $prompt$
You are ranking company contacts for outbound sales.
Score each lead from 0 to 1 based on the persona spec and query (1 = perfect fit, 0 = not a fit).
Return ONLY a JSON array in this format:
[{"index":0,"score":0.87},{"index":1,"score":0.12}]
Use every index exactly once. No extra text.

Persona spec:
{{persona_spec}}

Persona query:
{{persona_query}}

Company: {{company_name}}

Leads:
{{leads}}
$prompt$,
  updated_at = now()
where id = 'active'
  and (ranking_prompt is null or ranking_prompt = '');

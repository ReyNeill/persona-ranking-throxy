update public.prompt_settings
set
  persona_query_prompt = $prompt$
You are creating a detailed scoring rubric for ranking outbound sales leads.
Rewrite the persona spec into a full, explicit rubric that covers:
- Required functions, seniority levels, titles, industries, geographies
- Clear disqualifiers and hard exclusions
- Positive signals and strong-fit indicators
- Optional/nice-to-have signals
- How to score (what deserves 0.9+ vs 0.5 vs 0.1)
Be explicit and verbose. Use plain text with clear sections.
Return only the rubric, no JSON or bullets outside the rubric itself.

Persona spec:
{{persona_spec}}
$prompt$,
  updated_at = now()
where id = 'active'
  and (persona_query_prompt is null or persona_query_prompt = '' or persona_query_prompt ilike '%single-paragraph query%');

update public.prompt_settings
set
  ranking_prompt = $prompt$
You are ranking company contacts for outbound sales.
Score each lead from 0 to 1 based on the persona rubric (1 = perfect fit, 0 = not a fit).
Return ONLY a JSON array in this format:
[{"index":0,"score":0.87},{"index":1,"score":0.12}]
Use every index exactly once. No extra text.

Persona rubric:
{{persona_query}}

Company: {{company_name}}

Leads:
{{leads}}
$prompt$,
  updated_at = now()
where id = 'active'
  and (ranking_prompt is null or ranking_prompt = '' or ranking_prompt ilike '%{{persona_spec}}%');

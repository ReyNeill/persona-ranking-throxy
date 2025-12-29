const RANKING_PROMPT_PLACEHOLDERS = {
  PERSONA_QUERY: "{{persona_query}}",
  COMPANY_NAME: "{{company_name}}",
  LEADS: "{{leads}}",
} as const

export const DEFAULT_RANKING_PROMPT = [
  "You are ranking company contacts for outbound sales.",
  "Score each lead from 0 to 1 based on the persona rubric (1 = perfect fit, 0 = not a fit).",
  "Return ONLY a JSON array in this format:",
  '[{"index":0,"score":0.87},{"index":1,"score":0.12}]',
  "Use every index exactly once. No extra text.",
  "",
  "Persona rubric:",
  RANKING_PROMPT_PLACEHOLDERS.PERSONA_QUERY,
  "",
  `Company: ${RANKING_PROMPT_PLACEHOLDERS.COMPANY_NAME}`,
  "",
  "Leads:",
  RANKING_PROMPT_PLACEHOLDERS.LEADS,
].join("\n")

type RankingPromptPayload = {
  personaQuery: string
  companyName: string
  leads: string
}

export function renderRankingPrompt(
  template: string,
  { personaQuery, companyName, leads }: RankingPromptPayload
) {
  let prompt = template.trim()

  if (prompt.includes(RANKING_PROMPT_PLACEHOLDERS.PERSONA_QUERY)) {
    prompt = prompt.replaceAll(
      RANKING_PROMPT_PLACEHOLDERS.PERSONA_QUERY,
      personaQuery
    )
  } else {
    prompt = [prompt, "", "Persona rubric:", personaQuery].join("\n")
  }

  if (prompt.includes(RANKING_PROMPT_PLACEHOLDERS.COMPANY_NAME)) {
    prompt = prompt.replaceAll(
      RANKING_PROMPT_PLACEHOLDERS.COMPANY_NAME,
      companyName
    )
  } else {
    prompt = [prompt, "", `Company: ${companyName}`].join("\n")
  }

  if (prompt.includes(RANKING_PROMPT_PLACEHOLDERS.LEADS)) {
    prompt = prompt.replaceAll(RANKING_PROMPT_PLACEHOLDERS.LEADS, leads)
  } else {
    prompt = [prompt, "", "Leads:", leads].join("\n")
  }

  return prompt
}

export { RANKING_PROMPT_PLACEHOLDERS }

const RANKING_PROMPT_PLACEHOLDERS = {
  PERSONA_QUERY: "{{persona_query}}",
  COMPANY_NAME: "{{company_name}}",
  LEADS: "{{leads}}",
} as const

export const DEFAULT_RANKING_PROMPT = [
  "You are ranking company contacts for outbound sales.",
  "Score each lead on these axes using integers 0-5:",
  "- role (function/title fit)",
  "- seniority (seniority fit from title)",
  "- industry (industry fit when provided)",
  "- size (company size fit when provided)",
  "- data_quality (penalize missing/conflicting fields)",
  "Compute final as the average of the 5 axes scaled to 0-1.",
  "If key fields are missing, list them in a 'missing' array.",
  "Return ONLY a JSON array in this format:",
  '[{"index":0,"final":0.82,"scores":{"role":5,"seniority":4,"industry":3,"size":4,"data_quality":5},"missing":[]}]',
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

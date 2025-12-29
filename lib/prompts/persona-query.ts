const PERSONA_SPEC_PLACEHOLDER = "{{persona_spec}}"

export const DEFAULT_PERSONA_QUERY_PROMPT = [
  "You are creating a detailed scoring rubric for ranking outbound sales leads.",
  "Rewrite the persona spec into a full, explicit rubric that covers:",
  "- Required functions, seniority levels, titles, industries, geographies",
  "- Clear disqualifiers and hard exclusions",
  "- Positive signals and strong-fit indicators",
  "- Optional/nice-to-have signals",
  "- How to score (what deserves 0.9+ vs 0.5 vs 0.1)",
  "Be explicit and verbose. Use plain text with clear sections.",
  "Return only the rubric, no JSON or bullets outside the rubric itself.",
  "",
  `Persona spec:\n${PERSONA_SPEC_PLACEHOLDER}`,
].join("\n")

export function getPersonaQueryPromptTemplate() {
  return DEFAULT_PERSONA_QUERY_PROMPT
}

export function renderPersonaQueryPrompt(
  template: string,
  personaSpec: string
) {
  if (template.includes(PERSONA_SPEC_PLACEHOLDER)) {
    return template.replace(PERSONA_SPEC_PLACEHOLDER, personaSpec)
  }

  return [template.trim(), "", "Persona spec:", personaSpec].join("\n")
}

export { PERSONA_SPEC_PLACEHOLDER }

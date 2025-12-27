const PERSONA_SPEC_PLACEHOLDER = "{{persona_spec}}"

export const DEFAULT_PERSONA_QUERY_PROMPT = [
  "You are helping rank company contacts for outbound sales.",
  "Rewrite the persona spec into a concise, single-paragraph query that",
  "describes the ideal contact and explicit disqualifiers.",
  "Return only the query text, no bullets.",
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

import { describe, expect, it } from "bun:test"

import {
  DEFAULT_PERSONA_QUERY_PROMPT,
  PERSONA_SPEC_PLACEHOLDER,
  getPersonaQueryPromptTemplate,
  renderPersonaQueryPrompt,
} from "@/lib/prompts/persona-query"

describe("persona query prompt", () => {
  it("returns the default template", () => {
    expect(getPersonaQueryPromptTemplate()).toBe(DEFAULT_PERSONA_QUERY_PROMPT)
  })

  it("injects the persona spec when placeholder exists", () => {
    const result = renderPersonaQueryPrompt(
      `Hello ${PERSONA_SPEC_PLACEHOLDER}`,
      "CFO at fintech"
    )

    expect(result).toBe("Hello CFO at fintech")
  })

  it("appends persona spec when placeholder is missing", () => {
    const result = renderPersonaQueryPrompt("Keep it short.", "VP Sales")

    expect(result).toBe("Keep it short.\n\nPersona spec:\nVP Sales")
  })
})

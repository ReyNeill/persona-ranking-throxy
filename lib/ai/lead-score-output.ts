import type { JSONSchema7 } from "ai"

const leadScoreSchema: JSONSchema7 = {
  type: "array",
  items: {
    type: "object",
    properties: {
      index: { type: "integer", minimum: 0 },
      score: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["index", "score"],
    additionalProperties: false,
  },
}

function buildLeadScoreResponseFormat() {
  return {
    type: "json" as const,
    name: "lead_scores",
    description: "Scores for each lead index between 0 and 1.",
    schema: leadScoreSchema,
  }
}

export function buildLeadScoreOutput() {
  return {
    responseFormat: Promise.resolve(buildLeadScoreResponseFormat()),
    parseCompleteOutput: async ({ text }: { text: string }) => text,
    parsePartialOutput: async () => undefined,
  }
}

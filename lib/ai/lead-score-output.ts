import type { JSONSchema7 } from "ai"

const leadScoreSchema: JSONSchema7 = {
  type: "array",
  items: {
    type: "object",
    properties: {
      index: { type: "integer", minimum: 0 },
      final: { type: "number", minimum: 0, maximum: 1 },
      scores: {
        type: "object",
        properties: {
          role: { type: "number", minimum: 0, maximum: 5 },
          seniority: { type: "number", minimum: 0, maximum: 5 },
          industry: { type: "number", minimum: 0, maximum: 5 },
          size: { type: "number", minimum: 0, maximum: 5 },
          data_quality: { type: "number", minimum: 0, maximum: 5 },
        },
        required: ["role", "seniority", "industry", "size", "data_quality"],
        additionalProperties: false,
      },
      missing: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["index", "scores", "final"],
    additionalProperties: false,
  },
}

function buildLeadScoreResponseFormat() {
  return {
    type: "json" as const,
    name: "lead_scores",
    description:
      "Axis scores (0-5) and final score (0-1) for each lead index.",
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

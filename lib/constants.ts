// Ranking configuration limits
export const RANKING_CONFIG = {
  /** Maximum number of leads to select per company */
  MAX_TOP_N: 25,
  /** Minimum number of leads to select per company */
  MIN_TOP_N: 1,
  /** Default number of leads to select per company */
  DEFAULT_TOP_N: 3,
  /** Maximum relevance score threshold */
  MAX_SCORE: 1,
  /** Minimum relevance score threshold */
  MIN_SCORE: 0,
  /** Default relevance score threshold */
  DEFAULT_MIN_SCORE: 0.4,
} as const

// Default AI model identifiers
export const AI_MODELS = {
  /** Default Cohere rerank model */
  RERANK: process.env.RERANK_MODEL ?? "rerank-v3.5",
  /** Default OpenRouter model for persona query generation */
  OPENROUTER: process.env.OPENROUTER_MODEL ?? "openai/gpt-oss-120b",
} as const

// Cost configuration
export const COST_CONFIG = {
  /** Cost per 1000 Cohere rerank searches (in USD) */
  COHERE_RERANK_PER_1K: Number.parseFloat(
    process.env.COHERE_RERANK_COST_PER_1K_SEARCHES ?? ""
  ),
  /** OpenRouter input token cost per million (approximate, varies by model) */
  OPENROUTER_INPUT_PER_M: 0.15,
  /** OpenRouter output token cost per million (approximate, varies by model) */
  OPENROUTER_OUTPUT_PER_M: 0.60,
} as const

// Batch processing
export const BATCH_CONFIG = {
  /** Number of leads to insert per database batch */
  LEAD_INSERT_BATCH_SIZE: 500,
} as const


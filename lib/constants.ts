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
  /** Default OpenRouter model for persona query generation */
  OPENROUTER_QUERY: process.env.OPENROUTER_MODEL ?? "openai/gpt-oss-120b",
  /** Default OpenRouter model for lead scoring/ranking */
  OPENROUTER_RANK:
    process.env.OPENROUTER_RANK_MODEL ??
    process.env.OPENROUTER_MODEL ??
    "openai/gpt-oss-120b",
} as const

// Cost configuration
export const COST_CONFIG = {
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

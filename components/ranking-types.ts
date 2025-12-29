// Lead and company result types
export type LeadResult = {
  leadId: string
  fullName: string | null
  title: string | null
  email: string | null
  linkedinUrl: string | null
  score: number | null
  relevance: string | null
  rank: number | null
  selected: boolean
  reason: string | null
}

export type CompanyResult = {
  companyId: string
  companyName: string
  leads: LeadResult[]
}

export type RankingResponse = {
  runId: string | null
  createdAt?: string | null
  topN?: number | null
  minScore?: number | null
  personaSpec?: string | null
  companies: CompanyResult[]
}

// Stats types
export type StatsSummary = {
  callCount: number
  totalCost: number | null
  avgCost: number | null
  inputTokens: number
  outputTokens: number
  documents: number
}

export type StatsResponse = {
  totals: StatsSummary
  byProvider: Array<StatsSummary & { provider: string }>
  run: StatsSummary | null
}

// Progress and streaming types
export type ProgressStatus = "idle" | "running" | "completed" | "error"

export type RankingProgress = {
  status: ProgressStatus
  percent: number
  total: number
  completed: number
  message: string
}

export type RankingStreamEvent =
  | { type: "start"; runId: string; totalCompanies: number }
  | { type: "persona_ready"; runId: string }
  | {
      type: "company_start"
      runId: string
      companyId: string
      companyName: string
      index: number
      total: number
    }
  | {
      type: "company_result"
      runId: string
      company: CompanyResult
      completed: number
      total: number
    }
  | { type: "complete"; runId: string; completed: number; total: number }
  | { type: "error"; message: string }

// Prompt leaderboard types
export type PromptLeaderboardMetrics = {
  ndcg: number
  mrr: number
  precision: number
  top1: number
}

export type PromptLeaderboardEntry = {
  prompt: string
  score: number
  trainMetrics: PromptLeaderboardMetrics
  testMetrics: PromptLeaderboardMetrics
  query: string
  errorSummary: string
}

export type PromptLeaderboard = {
  objective: string | null
  k: number | null
  updatedAt: string | null
  queryModelId?: string | null
  optimizerModelId?: string | null
  rankModelId?: string | null
  evalPath?: string | null
  personaPath?: string | null
  entries: PromptLeaderboardEntry[]
}

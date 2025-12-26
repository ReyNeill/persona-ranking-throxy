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

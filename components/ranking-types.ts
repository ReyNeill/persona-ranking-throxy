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

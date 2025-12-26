import { generateText, rerank } from "ai"
import { cohere } from "@ai-sdk/cohere"

import { getOpenRouterModel } from "@/lib/ai/openrouter"
import { createSupabaseServerClient } from "@/lib/supabase/server"

type LeadRow = {
  id: string
  full_name: string | null
  title: string | null
  email: string | null
  linkedin_url: string | null
  company_id: string
  company: {
    id: string
    name: string
  }
}

type CompanyRelation = {
  id: string
  name: string
}

type LeadRowRaw = Omit<LeadRow, "company"> & {
  company: CompanyRelation | CompanyRelation[] | null
}

type LeadRelation = {
  id: string
  full_name: string | null
  title: string | null
  email: string | null
  linkedin_url: string | null
}

type RankingRowRaw = {
  score: number | null
  relevance: string | null
  rank: number | null
  selected: boolean | null
  reason: string | null
  lead: LeadRelation | LeadRelation[] | null
  company: CompanyRelation | CompanyRelation[] | null
}

type RankingRunInput = {
  personaSpec: string
  topN: number
  minScore: number
  ingestionId?: string | null
}

type RankedLead = {
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

type CompanyResults = {
  companyId: string
  companyName: string
  leads: RankedLead[]
}

const DEFAULT_RERANK_MODEL = process.env.RERANK_MODEL ?? "rerank-v3.5"
const DEFAULT_OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini"

function formatLeadText(lead: LeadRow) {
  const parts = [
    lead.full_name ? `Name: ${lead.full_name}` : null,
    lead.title ? `Title: ${lead.title}` : null,
    `Company: ${lead.company.name}`,
    lead.email ? `Email: ${lead.email}` : null,
    lead.linkedin_url ? `LinkedIn: ${lead.linkedin_url}` : null,
  ].filter(Boolean)

  return parts.join(" | ")
}

async function buildPersonaQuery(personaSpec: string) {
  const model = getOpenRouterModel(DEFAULT_OPENROUTER_MODEL)
  if (!model) return personaSpec

  try {
    const { text } = await generateText({
      // OpenRouter SDK model types don't match AI SDK language model typings yet.
      model: model as any,
      prompt: [
        "You are helping rank company contacts for outbound sales.",
        "Rewrite the persona spec into a concise, single-paragraph query that",
        "describes the ideal contact and explicit disqualifiers.",
        "Return only the query text, no bullets.",
        "",
        `Persona spec:\n${personaSpec}`,
      ].join("\n"),
    })

    const cleaned = text.trim()
    return cleaned.length > 0 ? cleaned : personaSpec
  } catch {
    return personaSpec
  }
}

function normalizeRelation<T>(value: T | T[] | null): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

function normalizeLead(raw: LeadRowRaw): LeadRow | null {
  const company = normalizeRelation(raw.company)
  if (!company) return null

  return {
    ...raw,
    company,
  }
}

export async function runRanking({
  personaSpec,
  topN,
  minScore,
  ingestionId,
}: RankingRunInput) {
  const supabase = createSupabaseServerClient()

  const { data: persona, error: personaError } = await supabase
    .from("personas")
    .insert({
      name: "Persona",
      spec: personaSpec,
    })
    .select()
    .single()

  if (personaError) {
    throw new Error(personaError.message)
  }

  const { data: run, error: runError } = await supabase
    .from("ranking_runs")
    .insert({
      persona_id: persona.id,
      ingestion_id: ingestionId ?? null,
      status: "running",
      top_n: topN,
      min_score: minScore,
      provider: "cohere",
      model: DEFAULT_RERANK_MODEL,
    })
    .select()
    .single()

  if (runError) {
    throw new Error(runError.message)
  }

  const leadQuery = supabase
    .from("leads")
    .select(
      "id, full_name, title, email, linkedin_url, company_id, company:companies(id, name)"
    )

  const { data: leads, error: leadsError } = ingestionId
    ? await leadQuery.eq("ingestion_id", ingestionId)
    : await leadQuery

  if (leadsError) {
    throw new Error(leadsError.message)
  }

  const normalizedLeads = (leads as LeadRowRaw[] | null)
    ?.map(normalizeLead)
    .filter((lead): lead is LeadRow => Boolean(lead))

  const grouped = new Map<string, LeadRow[]>()
  for (const lead of normalizedLeads ?? []) {
    const list = grouped.get(lead.company.id) ?? []
    list.push(lead)
    grouped.set(lead.company.id, list)
  }

  const query = await buildPersonaQuery(personaSpec)
  const allRankingRows: Array<{
    run_id: string
    lead_id: string
    company_id: string
    score: number | null
    relevance: string
    rank: number
    selected: boolean
    reason: string
  }> = []
  const companyResults: CompanyResults[] = []

  for (const [companyId, companyLeads] of grouped.entries()) {
    const documents = companyLeads.map(formatLeadText)
    if (documents.length === 0) continue

    const { ranking } = await rerank({
      model: cohere.reranking(DEFAULT_RERANK_MODEL),
      query,
      documents,
    })

    const sorted = [...ranking].sort(
      (a, b) => (b.score ?? 0) - (a.score ?? 0)
    )

    let relevantRank = 1
    const rankedLeads: RankedLead[] = []

    sorted.forEach((item, index) => {
      const lead = companyLeads[item.originalIndex]
      if (!lead) return
      const score = item.score ?? null
      const isRelevant = score !== null && score >= minScore
      const selected = isRelevant && relevantRank <= topN

      if (isRelevant) {
        relevantRank += 1
      }

      const reason = isRelevant
        ? "Matched persona criteria based on title and company context."
        : "Below relevance threshold for this persona."

      rankedLeads.push({
        leadId: lead.id,
        fullName: lead.full_name,
        title: lead.title,
        email: lead.email,
        linkedinUrl: lead.linkedin_url,
        score,
        relevance: isRelevant ? "relevant" : "irrelevant",
        rank: index + 1,
        selected,
        reason,
      })

      allRankingRows.push({
        run_id: run.id,
        lead_id: lead.id,
        company_id: companyId,
        score,
        relevance: isRelevant ? "relevant" : "irrelevant",
        rank: index + 1,
        selected,
        reason,
      })
    })

    companyResults.push({
      companyId,
      companyName: companyLeads[0]?.company.name ?? "Unknown",
      leads: rankedLeads,
    })
  }

  if (allRankingRows.length > 0) {
    const { error: insertError } = await supabase
      .from("lead_rankings")
      .insert(allRankingRows)

    if (insertError) {
      throw new Error(insertError.message)
    }
  }

  await supabase.from("ranking_runs").update({ status: "completed" }).eq("id", run.id)

  return {
    runId: run.id,
    createdAt: run.created_at,
    topN: run.top_n,
    minScore: run.min_score,
    personaSpec: persona.spec,
    companies: companyResults,
  }
}

export async function getRankingResults(runId?: string | null) {
  const supabase = createSupabaseServerClient()

  let run: any = null
  if (runId) {
    const { data, error } = await supabase
      .from("ranking_runs")
      .select()
      .eq("id", runId)
      .single()

    if (error) {
      throw new Error(error.message)
    }
    run = data
  } else {
    const { data, error } = await supabase
      .from("ranking_runs")
      .select()
      .order("created_at", { ascending: false })
      .limit(1)
      .single()

    if (error) {
      return null
    }
    run = data
  }

  const { data: rows, error: rowsError } = await supabase
    .from("lead_rankings")
    .select(
      "score, relevance, rank, selected, reason, lead:leads(id, full_name, title, email, linkedin_url), company:companies(id, name)"
    )
    .eq("run_id", run.id)
    .order("company_id", { ascending: true })
    .order("rank", { ascending: true })

  if (rowsError) {
    throw new Error(rowsError.message)
  }

  const grouped = new Map<string, CompanyResults>()
  for (const row of (rows as RankingRowRaw[] | null) ?? []) {
    const company = normalizeRelation(row.company)
    const lead = normalizeRelation(row.lead)
    if (!company || !lead) continue
    const existing = grouped.get(company.id)
    const entry: CompanyResults =
      existing ?? {
        companyId: company.id,
        companyName: company.name,
        leads: [],
      }

    entry.leads.push({
      leadId: lead.id,
      fullName: lead.full_name ?? null,
      title: lead.title ?? null,
      email: lead.email ?? null,
      linkedinUrl: lead.linkedin_url ?? null,
      score: row.score ?? null,
      relevance: row.relevance ?? null,
      rank: row.rank ?? null,
      selected: row.selected ?? false,
      reason: row.reason ?? null,
    })

    grouped.set(company.id, entry)
  }

  return {
    runId: run.id,
    createdAt: run.created_at,
    topN: run.top_n,
    minScore: run.min_score,
    personaSpec: null,
    companies: Array.from(grouped.values()),
  }
}

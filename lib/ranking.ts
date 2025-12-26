import {
  generateText,
  rerank,
  wrapLanguageModel,
  type LanguageModelUsage,
} from "ai"
import { cohere } from "@ai-sdk/cohere"

import { getOpenRouterModel } from "@/lib/ai/openrouter"
import {
  getPersonaQueryPromptTemplate,
  renderPersonaQueryPrompt,
} from "@/lib/prompts/persona-query"
import {
  createSupabaseServerClient,
  createSupabaseServerClientOptional,
} from "@/lib/supabase/server"

type LeadRow = {
  id: string
  full_name: string | null
  title: string | null
  email: string | null
  linkedin_url: string | null
  data?: Record<string, unknown> | null
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

type RankingRunOptions = {
  onProgress?: (event: RankingProgressEvent) => void | Promise<void>
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

export type RankingProgressEvent =
  | {
      type: "start"
      runId: string
      totalCompanies: number
    }
  | {
      type: "persona_ready"
      runId: string
    }
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
      company: CompanyResults
      completed: number
      total: number
    }
  | {
      type: "complete"
      runId: string
      completed: number
      total: number
    }

type PersonaQueryResult = {
  query: string
  usage?: LanguageModelUsage
  modelId?: string
  provider?: string
  costUsd?: number | null
  metadata?: Record<string, unknown> | null
}

const DEFAULT_RERANK_MODEL = process.env.RERANK_MODEL ?? "rerank-v3.5"
const DEFAULT_OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini"
const OPENROUTER_INPUT_COST = Number.parseFloat(
  process.env.OPENROUTER_COST_PER_1K_INPUT ??
    process.env.AI_COST_PER_1K_INPUT ??
    ""
)
const OPENROUTER_OUTPUT_COST = Number.parseFloat(
  process.env.OPENROUTER_COST_PER_1K_OUTPUT ??
    process.env.AI_COST_PER_1K_OUTPUT ??
    ""
)
const OPENROUTER_TOTAL_COST = Number.parseFloat(
  process.env.OPENROUTER_COST_PER_1K_TOKENS ??
    process.env.AI_COST_PER_1K_TOKENS ??
    ""
)
const RERANK_COST_PER_SEARCH = Number.parseFloat(
  process.env.COHERE_RERANK_COST_PER_SEARCH ??
    process.env.RERANK_COST_PER_SEARCH ??
    ""
)
const RERANK_COST_PER_1K_SEARCHES = Number.parseFloat(
  process.env.COHERE_RERANK_COST_PER_1K_SEARCHES ??
    process.env.RERANK_COST_PER_1K_SEARCHES ??
    ""
)
const RERANK_COST_PER_1K_DOCS = Number.parseFloat(
  process.env.COHERE_RERANK_COST_PER_1K_DOCS ??
    process.env.RERANK_COST_PER_1K_DOCS ??
    process.env.AI_COST_RERANK_PER_1K_DOCS ??
    ""
)

function formatLeadText(lead: LeadRow) {
  const employeeRange =
    process.env.INCLUDE_EMPLOYEE_RANGE === "true"
      ? extractEmployeeRange(lead.data)
      : null
  const parts = [
    lead.full_name ? `Name: ${lead.full_name}` : null,
    lead.title ? `Title: ${lead.title}` : null,
    `Company: ${lead.company.name}`,
    employeeRange ? `Employee Range: ${employeeRange}` : null,
    lead.email ? `Email: ${lead.email}` : null,
    lead.linkedin_url ? `LinkedIn: ${lead.linkedin_url}` : null,
  ].filter(Boolean)

  return parts.join(" | ")
}

function extractEmployeeRange(data?: Record<string, unknown> | null) {
  if (!data) return null
  const keys = [
    "employee range",
    "employee_range",
    "employeeRange",
    "employees",
    "employee count",
    "employee_count",
  ]
  for (const key of keys) {
    const value = data[key]
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number") return value.toString()
  }
  return null
}

function normalizeRate(value: number) {
  return Number.isFinite(value) ? value : null
}

const openrouterInputRate = normalizeRate(OPENROUTER_INPUT_COST)
const openrouterOutputRate = normalizeRate(OPENROUTER_OUTPUT_COST)
const openrouterTotalRate = normalizeRate(OPENROUTER_TOTAL_COST)
const rerankSearchRate = normalizeRate(RERANK_COST_PER_SEARCH)
const rerankSearchRatePer1k = normalizeRate(RERANK_COST_PER_1K_SEARCHES)
const rerankDocRate = normalizeRate(RERANK_COST_PER_1K_DOCS)

function computeGenerationCost(usage?: LanguageModelUsage) {
  if (!usage) return null
  const inputTokens = usage.inputTokens ?? 0
  const outputTokens = usage.outputTokens ?? 0
  const totalTokens = usage.totalTokens ?? inputTokens + outputTokens

  if (openrouterInputRate !== null || openrouterOutputRate !== null) {
    return (
      (inputTokens / 1000) * (openrouterInputRate ?? 0) +
      (outputTokens / 1000) * (openrouterOutputRate ?? 0)
    )
  }

  if (openrouterTotalRate !== null) {
    return (totalTokens / 1000) * openrouterTotalRate
  }

  return null
}

function computeRerankCost(documentsCount: number) {
  if (rerankSearchRate !== null) return rerankSearchRate
  if (rerankSearchRatePer1k !== null) return rerankSearchRatePer1k / 1000
  if (rerankDocRate === null) return null
  return (documentsCount / 1000) * rerankDocRate
}

async function wrapWithDevtools(model: ReturnType<typeof getOpenRouterModel>) {
  if (!model) return null
  if (process.env.NODE_ENV === "production") return model
  if (process.env.AI_DEVTOOLS !== "true") return model

  const specVersion = (model as { specificationVersion?: string })
    .specificationVersion
  if (specVersion !== "v3") {
    return model
  }

  try {
    const { devToolsMiddleware } = await import("@ai-sdk/devtools")
    return wrapLanguageModel({
      model: model as any,
      middleware: devToolsMiddleware(),
    })
  } catch {
    return model
  }
}

async function buildPersonaQuery(
  personaSpec: string,
  promptTemplateOverride?: string | null
): Promise<PersonaQueryResult> {
  const model = getOpenRouterModel(DEFAULT_OPENROUTER_MODEL)
  const promptTemplate =
    promptTemplateOverride?.trim() || getPersonaQueryPromptTemplate()
  if (!model) return { query: personaSpec }

  try {
    const wrappedModel = await wrapWithDevtools(model)
    const prompt = renderPersonaQueryPrompt(promptTemplate, personaSpec)
    const result = await generateText({
      // OpenRouter SDK model types don't match AI SDK language model typings yet.
      model: wrappedModel as any,
      prompt,
    })

    const cleaned = result.text.trim()
    const openrouterUsage =
      (result.providerMetadata as any)?.openrouter?.usage ?? null
    const costUsd =
      typeof openrouterUsage?.cost === "number"
        ? openrouterUsage.cost
        : computeGenerationCost(result.usage)
    return {
      query: cleaned.length > 0 ? cleaned : personaSpec,
      usage: result.usage,
      modelId: result.response?.modelId ?? DEFAULT_OPENROUTER_MODEL,
      provider: "openrouter",
      costUsd,
      metadata: openrouterUsage ? { openrouterUsage } : null,
    }
  } catch {
    return { query: personaSpec }
  }
}

async function getActivePersonaQueryPrompt(
  supabase: ReturnType<typeof createSupabaseServerClient>
) {
  try {
    const { data, error } = await supabase
      .from("prompt_settings")
      .select("persona_query_prompt")
      .eq("id", "active")
      .single()

    if (error) return null
    return data?.persona_query_prompt ?? null
  } catch {
    return null
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

async function recordAiCall(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  payload: {
    run_id: string
    provider: string
    model?: string | null
    operation: "generate_text" | "rerank"
    input_tokens?: number | null
    output_tokens?: number | null
    total_tokens?: number | null
    documents_count?: number | null
    cost_usd?: number | null
    metadata?: Record<string, unknown> | null
  }
) {
  const { error } = await supabase.from("ai_calls").insert({
    ...payload,
    model: payload.model ?? null,
    input_tokens: payload.input_tokens ?? null,
    output_tokens: payload.output_tokens ?? null,
    total_tokens: payload.total_tokens ?? null,
    documents_count: payload.documents_count ?? null,
    cost_usd: payload.cost_usd ?? null,
    metadata: payload.metadata ?? null,
  })

  if (error) {
    console.warn("Failed to record AI call:", error.message)
  }
}

export async function runRanking({
  personaSpec,
  topN,
  minScore,
  ingestionId,
}: RankingRunInput, options?: RankingRunOptions) {
  const supabase = createSupabaseServerClient()
  const notifyProgress = options?.onProgress
  const emit = async (event: RankingProgressEvent) => {
    if (notifyProgress) {
      await notifyProgress(event)
    }
  }

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
      "id, full_name, title, email, linkedin_url, data, company_id, company:companies(id, name)"
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

  const activePrompt = await getActivePersonaQueryPrompt(supabase)
  const personaQuery = await buildPersonaQuery(personaSpec, activePrompt)
  await emit({ type: "persona_ready", runId: run.id })

  const totalCompanies = grouped.size
  await emit({ type: "start", runId: run.id, totalCompanies })

  if (personaQuery.usage || personaQuery.provider) {
    const usage = personaQuery.usage
    const inputTokens = usage?.inputTokens ?? null
    const outputTokens = usage?.outputTokens ?? null
    const totalTokens = usage?.totalTokens ?? null
    const costUsd = computeGenerationCost(usage)

    await recordAiCall(supabase, {
      run_id: run.id,
      provider: personaQuery.provider ?? "openrouter",
      model: personaQuery.modelId ?? DEFAULT_OPENROUTER_MODEL,
      operation: "generate_text",
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      cost_usd: personaQuery.costUsd ?? costUsd,
      metadata: personaQuery.metadata ?? null,
    })
  }

  const query = personaQuery.query
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
  let completedCompanies = 0

  for (const [companyId, companyLeads] of grouped.entries()) {
    const companyName = companyLeads[0]?.company.name ?? "Unknown"
    await emit({
      type: "company_start",
      runId: run.id,
      companyId,
      companyName,
      index: completedCompanies + 1,
      total: totalCompanies,
    })
    const documents = companyLeads.map(formatLeadText)
    if (documents.length === 0) continue

    const rerankResult = await rerank({
      model: cohere.reranking(DEFAULT_RERANK_MODEL),
      query,
      documents,
    })
    const { ranking } = rerankResult

    await recordAiCall(supabase, {
      run_id: run.id,
      provider: "cohere",
      model: rerankResult.response?.modelId ?? DEFAULT_RERANK_MODEL,
      operation: "rerank",
      documents_count: documents.length,
      cost_usd: computeRerankCost(documents.length),
      metadata: {
        companyId,
        companyName: companyLeads[0]?.company.name ?? null,
      },
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
      companyName,
      leads: rankedLeads,
    })

    completedCompanies += 1
    await emit({
      type: "company_result",
      runId: run.id,
      company: {
        companyId,
        companyName,
        leads: rankedLeads,
      },
      completed: completedCompanies,
      total: totalCompanies,
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

  await supabase
    .from("ranking_runs")
    .update({ status: "completed" })
    .eq("id", run.id)
  await emit({
    type: "complete",
    runId: run.id,
    completed: completedCompanies,
    total: totalCompanies,
  })

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
  const supabase = createSupabaseServerClientOptional()
  if (!supabase) {
    return null
  }

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

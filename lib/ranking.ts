import { generateText, wrapLanguageModel, type LanguageModelUsage } from "ai"

import { getOpenRouterModel } from "@/lib/ai/openrouter"
import { buildLeadScoreOutput } from "@/lib/ai/lead-score-output"
import { AI_MODELS, COST_CONFIG } from "@/lib/constants"
import {
  getPersonaQueryPromptTemplate,
  renderPersonaQueryPrompt,
} from "@/lib/prompts/persona-query"
import {
  DEFAULT_RANKING_PROMPT,
  renderRankingPrompt,
} from "@/lib/prompts/ranking-prompt"
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
  /** AbortSignal to cancel the ranking operation early */
  signal?: AbortSignal
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

const DEFAULT_QUERY_MODEL = AI_MODELS.OPENROUTER_QUERY
const DEFAULT_RANK_MODEL = AI_MODELS.OPENROUTER_RANK

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

type Phrase = {
  raw: string
  norm: string
}

const SENIORITY_KEYWORDS = [
  "vp",
  "vice president",
  "head",
  "director",
  "chief",
  "c-level",
  "ceo",
  "cfo",
  "coo",
  "cmo",
  "cro",
  "founder",
  "owner",
  "president",
  "lead",
  "principal",
]

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

function extractPersonaPhrases(spec: string, label: string) {
  const regex = new RegExp(`${label}\\s*:\\s*([^\\n.]+)`, "i")
  const match = spec.match(regex)
  if (!match) return []
  return match[1]
    .split(/,|;|\n|\//g)
    .map((part) => part.replace(/[()]/g, "").trim())
    .filter(Boolean)
}

function buildPhraseList(rawPhrases: string[]) {
  return rawPhrases
    .map((raw) => ({ raw, norm: normalizeText(raw) }))
    .filter((phrase) => phrase.norm.length > 0)
}

function findPhraseMatch(phrases: Phrase[], haystack: string) {
  return phrases.find((phrase) => haystack.includes(phrase.norm)) ?? null
}

function buildHeuristicReason({
  title,
  companyName,
  personaSpec,
  isRelevant,
}: {
  title: string | null
  companyName: string
  personaSpec: string
  isRelevant: boolean
}) {
  const titleNorm = normalizeText(title ?? "")
  const combinedNorm = normalizeText(`${title ?? ""} ${companyName}`)

  const targetPhrases = buildPhraseList(
    extractPersonaPhrases(personaSpec, "Target")
  )
  const avoidPhrases = buildPhraseList(
    extractPersonaPhrases(personaSpec, "Avoid")
  )
  const preferPhrases = buildPhraseList(
    extractPersonaPhrases(personaSpec, "Prefer")
  )
  const seniorityPhrases = buildPhraseList(SENIORITY_KEYWORDS)

  const avoidMatch = findPhraseMatch(avoidPhrases, titleNorm)
  if (avoidMatch) {
    return `Below threshold: ${avoidMatch.raw} role detected.`
  }

  const targetMatch = findPhraseMatch(targetPhrases, titleNorm)
  const seniorityMatch = findPhraseMatch(seniorityPhrases, titleNorm)
  const preferMatch = findPhraseMatch(preferPhrases, combinedNorm)

  if (isRelevant) {
    const parts: string[] = []
    if (targetMatch) {
      parts.push(`Target role: ${targetMatch.raw}`)
    } else if (seniorityMatch) {
      parts.push(`Seniority: ${seniorityMatch.raw}`)
    }
    if (preferMatch) {
      parts.push(`Industry fit: ${preferMatch.raw}`)
    }
    return parts.length > 0
      ? `${parts.join(". ")}.`
      : "Relevant based on persona match signals."
  }

  if (targetMatch) {
    return `Below threshold despite target role: ${targetMatch.raw}.`
  }
  if (seniorityMatch) {
    return `Below threshold despite seniority: ${seniorityMatch.raw}.`
  }
  if (preferMatch) {
    return `Below threshold despite industry fit: ${preferMatch.raw}.`
  }
  return "Below relevance threshold for this persona."
}

type LeadScoreItem = {
  index: number
  score: number
}

function getResponseHealingOptions() {
  return {
    openrouter: {
      plugins: [{ id: "response-healing" }],
    },
  }
}

function buildLeadScoringPrompt(
  promptTemplate: string,
  payload: {
    personaQuery: string
    companyName: string
    leads: LeadRow[]
  }
) {
  const leadLines = payload.leads
    .map((lead, index) => `${index}. ${formatLeadText(lead)}`)
    .join("\n")

  return renderRankingPrompt(promptTemplate, {
    personaQuery: payload.personaQuery,
    companyName: payload.companyName,
    leads: leadLines,
  })
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function extractJsonPayload(text: string): string | null {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const content = fencedMatch ? fencedMatch[1] : text
  const arrayStart = content.indexOf("[")
  const arrayEnd = content.lastIndexOf("]")
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return content.slice(arrayStart, arrayEnd + 1)
  }
  const objectStart = content.indexOf("{")
  const objectEnd = content.lastIndexOf("}")
  if (objectStart >= 0 && objectEnd > objectStart) {
    return content.slice(objectStart, objectEnd + 1)
  }
  return null
}

function parseLeadScores(
  text: string,
  count: number
): { scores: number[]; parsedCount: number } {
  const scores = Array.from({ length: count }, () => 0)
  let parsedCount = 0
  const payload = extractJsonPayload(text)
  if (!payload) return { scores, parsedCount }

  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return { scores, parsedCount }
  }

  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { items?: unknown }).items)
      ? (parsed as { items: unknown[] }).items
      : null

  if (!items) return { scores, parsedCount }

  for (const item of items) {
    if (!item || typeof item !== "object") continue
    const typed = item as Partial<LeadScoreItem>
    const index = Number(typed.index)
    const score = Number(typed.score)
    if (!Number.isFinite(index) || index < 0 || index >= count) continue
    scores[index] = clampScore(score)
    parsedCount += 1
  }

  return { scores, parsedCount }
}

function computeGenerationCost(usage?: LanguageModelUsage): number | null {
  if (!usage) return null

  const inputCost = COST_CONFIG.OPENROUTER_INPUT_PER_M
  const outputCost = COST_CONFIG.OPENROUTER_OUTPUT_PER_M

  if (!Number.isFinite(inputCost) || !Number.isFinite(outputCost)) return null

  // AI SDK v6 uses inputTokens/outputTokens
  const inputTokens = usage.inputTokens ?? 0
  const outputTokens = usage.outputTokens ?? 0

  return (inputTokens * inputCost + outputTokens * outputCost) / 1_000_000
}

// Type for the model returned by generateText
type GenerateTextModel = Parameters<typeof generateText>[0]["model"]

async function wrapWithDevtools(
  model: ReturnType<typeof getOpenRouterModel>
): Promise<GenerateTextModel | null> {
  if (!model) return null

  if (typeof globalThis !== "undefined") {
    ;(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS =
      false
  }

  // Cast to the type expected by generateText - OpenRouter SDK types don't fully
  // match AI SDK v6 yet but the runtime implementation is compatible
  const typedModel = model as unknown as GenerateTextModel

  if (process.env.NODE_ENV === "production") return typedModel
  if (process.env.AI_DEVTOOLS !== "true") return typedModel

  const specVersion = (model as { specificationVersion?: string })
    .specificationVersion
  if (specVersion !== "v3") {
    return typedModel
  }

  try {
    const { devToolsMiddleware } = await import("@ai-sdk/devtools")
    // wrapLanguageModel returns a compatible type - cast through unknown
    // since OpenRouter SDK spec version differs from what AI SDK v6 expects
    const wrapped = wrapLanguageModel({
      model: model as unknown as Parameters<typeof wrapLanguageModel>[0]["model"],
      middleware: devToolsMiddleware(),
    })
    return wrapped as GenerateTextModel
  } catch {
    return typedModel
  }
}

type OpenRouterUsageMetadata = {
  openrouter?: {
    usage?: {
      cost?: number
    }
  }
}

async function buildPersonaQuery(
  personaSpec: string,
  promptTemplateOverride?: string | null
): Promise<PersonaQueryResult> {
  const model = getOpenRouterModel(DEFAULT_QUERY_MODEL)
  const promptTemplate =
    promptTemplateOverride?.trim() || getPersonaQueryPromptTemplate()
  if (!model) return { query: personaSpec }

  try {
    const wrappedModel = await wrapWithDevtools(model)
    if (!wrappedModel) return { query: personaSpec }

    const prompt = renderPersonaQueryPrompt(promptTemplate, personaSpec)
    const result = await generateText({
      model: wrappedModel,
      prompt,
    })

    const cleaned = result.text.trim()
    const providerMeta = result.providerMetadata as
      | OpenRouterUsageMetadata
      | undefined
    const openrouterUsage = providerMeta?.openrouter?.usage ?? null
    const costUsd =
      typeof openrouterUsage?.cost === "number"
        ? openrouterUsage.cost
        : computeGenerationCost(result.usage)
    return {
      query: cleaned.length > 0 ? cleaned : personaSpec,
      usage: result.usage,
      modelId: result.response?.modelId ?? DEFAULT_QUERY_MODEL,
      provider: "openrouter",
      costUsd,
      metadata: openrouterUsage ? { openrouterUsage } : null,
    }
  } catch (error) {
    // Fail gracefully - if query generation fails, use raw persona spec
    console.warn(
      "Failed to generate persona query, using raw spec:",
      error instanceof Error ? error.message : "Unknown error"
    )
    return { query: personaSpec }
  }
}

/**
 * Fetch the active optimized prompt from the database.
 * Returns null if not found or on error (fails gracefully).
 */
async function getActivePersonaQueryPrompt(
  supabase: ReturnType<typeof createSupabaseServerClient>
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("prompt_settings")
      .select("persona_query_prompt")
      .eq("id", "active")
      .single()

    if (error) {
      // Expected when no prompt is configured yet
      return null
    }
    return data?.persona_query_prompt ?? null
  } catch (error) {
    // Fail gracefully - use default prompt if database lookup fails
    console.warn(
      "Failed to fetch active prompt, using default:",
      error instanceof Error ? error.message : "Unknown error"
    )
    return null
  }
}

/**
 * Fetch the active ranking prompt from the database.
 * Returns null if not found or on error (fails gracefully).
 */
async function getActiveRankingPrompt(
  supabase: ReturnType<typeof createSupabaseServerClient>
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("prompt_settings")
      .select("ranking_prompt")
      .eq("id", "active")
      .single()

    if (error) {
      return null
    }
    return data?.ranking_prompt ?? null
  } catch (error) {
    console.warn(
      "Failed to fetch active ranking prompt, using default:",
      error instanceof Error ? error.message : "Unknown error"
    )
    return null
  }
}

type LeaderboardEntry = {
  prompt?: string | null
  score?: number | null
}

async function getLeaderboardRankingPrompt(
  supabase: ReturnType<typeof createSupabaseServerClient>
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("prompt_leaderboards")
      .select("data")
      .eq("id", "active")
      .single()

    if (error) return null

    const entries = (data?.data as { entries?: LeaderboardEntry[] } | null)
      ?.entries
    if (!entries || entries.length === 0) return null

    let best: LeaderboardEntry | null = null
    let bestScore = -Infinity
    for (const entry of entries) {
      const score = typeof entry.score === "number" ? entry.score : -Infinity
      if (!entry.prompt) continue
      if (score > bestScore) {
        bestScore = score
        best = entry
      }
    }

    return best?.prompt ?? null
  } catch (error) {
    console.warn(
      "Failed to fetch leaderboard prompt, using fallback:",
      error instanceof Error ? error.message : "Unknown error"
    )
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

function normalizeDedupeValue(value?: string | null) {
  return value?.trim().toLowerCase() ?? ""
}

function buildLeadDedupeKey(input: {
  companyId: string
  fullName?: string | null
  title?: string | null
  email?: string | null
  linkedinUrl?: string | null
}) {
  return [
    input.companyId,
    normalizeDedupeValue(input.fullName),
    normalizeDedupeValue(input.title),
    normalizeDedupeValue(input.email),
    normalizeDedupeValue(input.linkedinUrl),
  ].join("|")
}

function leadQualityScore(lead: {
  fullName?: string | null
  title?: string | null
  email?: string | null
  linkedinUrl?: string | null
}) {
  let score = 0
  if (lead.fullName) score += 1
  if (lead.title) score += 1
  if (lead.linkedinUrl) score += 2
  if (lead.email) score += 3
  return score
}

async function recordAiCall(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  payload: {
    run_id: string
    provider: string
    model?: string | null
    operation: "generate_text" | "rank"
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

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("Ranking operation was aborted")
    error.name = "AbortError"
    throw error
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
  const signal = options?.signal

  const emit = async (event: RankingProgressEvent) => {
    if (signal?.aborted) return
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
      provider: "openrouter",
      model: DEFAULT_RANK_MODEL,
    })
    .select()
    .single()

  if (runError) {
    throw new Error(runError.message)
  }

  const updateRunStatus = async (status: string, errorMessage: string | null) => {
    const { error } = await supabase
      .from("ranking_runs")
      .update({
        status,
        completed_at: new Date().toISOString(),
        error_message: errorMessage,
      })
      .eq("id", run.id)
    if (error) {
      console.warn("Failed to update ranking run status:", error.message)
    }
  }

  try {
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

    const groupedByCompany = new Map<string, Map<string, LeadRow>>()
    let duplicateLeads = 0
    for (const lead of normalizedLeads ?? []) {
      const companyId = lead.company.id
      const key = buildLeadDedupeKey({
        companyId,
        fullName: lead.full_name,
        title: lead.title,
        email: lead.email,
        linkedinUrl: lead.linkedin_url,
      })
      const companyMap = groupedByCompany.get(companyId) ?? new Map()
      const existing = companyMap.get(key)
      if (existing) {
        duplicateLeads += 1
        if (leadQualityScore({
          fullName: lead.full_name,
          title: lead.title,
          email: lead.email,
          linkedinUrl: lead.linkedin_url,
        }) > leadQualityScore({
          fullName: existing.full_name,
          title: existing.title,
          email: existing.email,
          linkedinUrl: existing.linkedin_url,
        })) {
          companyMap.set(key, lead)
        }
        groupedByCompany.set(companyId, companyMap)
        continue
      }
      companyMap.set(key, lead)
      groupedByCompany.set(companyId, companyMap)
    }

    if (duplicateLeads > 0) {
      console.warn(
        `Deduped ${duplicateLeads} duplicate lead(s) before ranking.`
      )
    }

    const grouped = new Map<string, LeadRow[]>()
    for (const [companyId, map] of groupedByCompany.entries()) {
      grouped.set(companyId, Array.from(map.values()))
    }

    const activeQueryPrompt = await getActivePersonaQueryPrompt(supabase)
    const personaQuery = await buildPersonaQuery(personaSpec, activeQueryPrompt)
    const activeRankingPrompt =
      (await getLeaderboardRankingPrompt(supabase)) ??
      (await getActiveRankingPrompt(supabase)) ??
      DEFAULT_RANKING_PROMPT
    await emit({ type: "persona_ready", runId: run.id })

    const rankModelRaw = getOpenRouterModel(DEFAULT_RANK_MODEL)
    if (!rankModelRaw) {
      throw new Error("Missing OPENROUTER_API_KEY for ranking.")
    }
    const rankModel = await wrapWithDevtools(rankModelRaw)
    if (!rankModel) {
      throw new Error("Unable to initialize ranking model.")
    }

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
        model: personaQuery.modelId ?? DEFAULT_QUERY_MODEL,
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

    // Check for abort before starting the main ranking loop
    checkAborted(signal)

    for (const [companyId, companyLeads] of grouped.entries()) {
      // Check for abort at the start of each company iteration
      checkAborted(signal)

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

      const prompt = buildLeadScoringPrompt(activeRankingPrompt, {
        personaQuery: query,
        companyName,
        leads: companyLeads,
      })
      let rankResult: Awaited<ReturnType<typeof generateText>>
      try {
        rankResult = await generateText({
          model: rankModel,
          prompt,
          output: buildLeadScoreOutput(),
          providerOptions: getResponseHealingOptions(),
        })
      } catch (error) {
        console.warn(
          "Lead scoring with structured outputs failed; retrying without response format.",
          error instanceof Error ? error.message : error
        )
        rankResult = await generateText({
          model: rankModel,
          prompt,
        })
      }

      const { scores, parsedCount } = parseLeadScores(
        rankResult.text,
        companyLeads.length
      )
      if (parsedCount === 0) {
        console.warn(
          "Lead scoring output could not be parsed; defaulting to zero scores.",
          { companyId, companyName }
        )
      }

      const providerMeta = rankResult.providerMetadata as
        | OpenRouterUsageMetadata
        | undefined
      const openrouterUsage = providerMeta?.openrouter?.usage ?? null
      const costUsd =
        typeof openrouterUsage?.cost === "number"
          ? openrouterUsage.cost
          : computeGenerationCost(rankResult.usage)

      await recordAiCall(supabase, {
        run_id: run.id,
        provider: "openrouter",
        model: rankResult.response?.modelId ?? DEFAULT_RANK_MODEL,
        operation: "rank",
        input_tokens: rankResult.usage?.inputTokens ?? null,
        output_tokens: rankResult.usage?.outputTokens ?? null,
        total_tokens: rankResult.usage?.totalTokens ?? null,
        documents_count: documents.length,
        cost_usd: costUsd,
        metadata: {
          companyId,
          companyName: companyLeads[0]?.company.name ?? null,
          openrouterUsage: openrouterUsage ?? null,
        },
      })

      const sorted = scores
        .map((score, index) => ({ score, originalIndex: index }))
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

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

        const reason = buildHeuristicReason({
          title: lead.title,
          companyName,
          personaSpec,
          isRelevant,
        })

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

    await updateRunStatus("completed", null)
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    const status =
      error instanceof Error && error.name === "AbortError"
        ? "cancelled"
        : "failed"
    await updateRunStatus(status, status === "failed" ? message : null)
    throw error
  }
}

type RankingRunRow = {
  id: string
  created_at: string
  top_n: number
  min_score: number
  persona_id: string
  ingestion_id: string | null
  status: string
  model: string | null
  provider: string | null
}

export async function getRankingResults(runId?: string | null) {
  const supabase = createSupabaseServerClientOptional()
  if (!supabase) {
    return null
  }

  let run: RankingRunRow | null = null
  if (runId) {
    const { data, error } = await supabase
      .from("ranking_runs")
      .select()
      .eq("id", runId)
      .single()

    if (error) {
      throw new Error(error.message)
    }
    run = data as RankingRunRow
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
    run = data as RankingRunRow
  }

  if (!run) {
    return null
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
  const seenByCompany = new Map<string, Set<string>>()
  for (const row of (rows as RankingRowRaw[] | null) ?? []) {
    const company = normalizeRelation(row.company)
    const lead = normalizeRelation(row.lead)
    if (!company || !lead) continue
    const dedupeKey = buildLeadDedupeKey({
      companyId: company.id,
      fullName: lead.full_name ?? null,
      title: lead.title ?? null,
      email: lead.email ?? null,
      linkedinUrl: lead.linkedin_url ?? null,
    })
    const seen = seenByCompany.get(company.id) ?? new Set<string>()
    if (seen.has(dedupeKey)) {
      continue
    }
    seen.add(dedupeKey)
    seenByCompany.set(company.id, seen)
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

  const dedupedCompanies = Array.from(grouped.values()).map((company) => {
    const sorted = [...company.leads].sort((a, b) => {
      const scoreA = a.score ?? 0
      const scoreB = b.score ?? 0
      if (scoreA !== scoreB) return scoreB - scoreA
      return (a.rank ?? 0) - (b.rank ?? 0)
    })
    let relevantRank = 1
    const recomputed = sorted.map((lead, index) => {
      const score = lead.score ?? null
      const isRelevant = score !== null && score >= run.min_score
      const selected = isRelevant && relevantRank <= run.top_n
      if (isRelevant) {
        relevantRank += 1
      }
      return {
        ...lead,
        rank: index + 1,
        relevance: isRelevant ? "relevant" : "irrelevant",
        selected,
      }
    })

    return {
      ...company,
      leads: recomputed,
    }
  })

  return {
    runId: run.id,
    createdAt: run.created_at,
    topN: run.top_n,
    minScore: run.min_score,
    personaSpec: null,
    companies: dedupedCompanies,
  }
}

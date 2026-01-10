import { generateText, wrapLanguageModel, type LanguageModelUsage } from "ai"

import { getOpenRouterModel } from "@/lib/ai/openrouter"
import {
  generateCacheKey,
  generatePersonaHash,
  checkRankingCache,
  storeRankingCache,
  calculateConfidence,
} from "@/lib/ranking-cache"
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
  const industry = extractIndustry(lead.data)
  const parts = [
    lead.full_name ? `Name: ${lead.full_name}` : null,
    lead.title ? `Title: ${lead.title}` : null,
    `Company: ${lead.company.name}`,
    industry ? `Industry: ${industry}` : null,
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
    "account_employee_range",
    "account employee range",
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

function extractIndustry(data?: Record<string, unknown> | null) {
  if (!data) return null
  const keys = [
    "industry",
    "account_industry",
    "account industry",
    "company_industry",
    "company industry",
  ]
  for (const key of keys) {
    const value = data[key]
    if (typeof value === "string" && value.trim()) return value.trim()
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
  shortlisted = true,
}: {
  title: string | null
  companyName: string
  personaSpec: string
  isRelevant: boolean
  shortlisted?: boolean
}) {
  if (!shortlisted) {
    return "Not in shortlist; below heuristic threshold."
  }
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
  score?: number
  final?: number
  scores?: {
    role?: number
    seniority?: number
    industry?: number
    size?: number
    data_quality?: number
  }
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

function clampAxis(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(5, value))
}

function computeFinalScore(axes?: LeadScoreItem["scores"]) {
  if (!axes) return null
  const values = [
    axes.role,
    axes.seniority,
    axes.industry,
    axes.size,
    axes.data_quality,
  ]
  let sum = 0
  let seen = false
  for (const value of values) {
    if (Number.isFinite(value)) {
      sum += clampAxis(value as number)
      seen = true
    } else {
      sum += 0
    }
  }
  if (!seen) return null
  return clampScore(sum / 25)
}

type ShortlistEntry = {
  lead: LeadRow
  originalIndex: number
  score: number
  quality: number
}

type ShortlistScorer = {
  targetPhrases: Phrase[]
  avoidPhrases: Phrase[]
  preferPhrases: Phrase[]
  seniorityPhrases: Phrase[]
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

const SHORTLIST_MULTIPLIER = parsePositiveInt(
  process.env.RANKING_SHORTLIST_MULTIPLIER,
  8
)
const SHORTLIST_MIN = parsePositiveInt(process.env.RANKING_SHORTLIST_MIN, 20)
const SHORTLIST_MAX = parsePositiveInt(process.env.RANKING_SHORTLIST_MAX, 200)
const RERANK_PASSES = parsePositiveInt(process.env.RANKING_PASSES, 2)
const PARALLEL_COMPANIES = parsePositiveInt(process.env.RANKING_PARALLEL_COMPANIES, 5)

function buildShortlistScorer(personaSpec: string): ShortlistScorer {
  return {
    targetPhrases: buildPhraseList(
      extractPersonaPhrases(personaSpec, "Target")
    ),
    avoidPhrases: buildPhraseList(extractPersonaPhrases(personaSpec, "Avoid")),
    preferPhrases: buildPhraseList(
      extractPersonaPhrases(personaSpec, "Prefer")
    ),
    seniorityPhrases: buildPhraseList(SENIORITY_KEYWORDS),
  }
}

function scoreLeadForShortlist(lead: LeadRow, scorer: ShortlistScorer) {
  const titleNorm = normalizeText(lead.title ?? "")
  const industry = extractIndustry(lead.data)
  const combinedNorm = normalizeText(
    `${lead.title ?? ""} ${lead.company.name} ${industry ?? ""}`
  )

  const targetMatch = findPhraseMatch(scorer.targetPhrases, titleNorm)
  const avoidMatch = findPhraseMatch(scorer.avoidPhrases, titleNorm)
  const preferMatch = findPhraseMatch(scorer.preferPhrases, combinedNorm)
  const seniorityMatch = findPhraseMatch(scorer.seniorityPhrases, titleNorm)

  let score = 0
  if (targetMatch) score += 6
  if (seniorityMatch) score += 2
  if (preferMatch) score += 1
  if (avoidMatch) score -= 6

  const quality = leadQualityScore({
    fullName: lead.full_name,
    title: lead.title,
    email: lead.email,
    linkedinUrl: lead.linkedin_url,
  })

  score += quality * 0.1

  return { score, quality }
}

function buildShortlist(leads: LeadRow[], personaSpec: string, topN: number) {
  if (leads.length === 0) {
    return {
      entries: [] as ShortlistEntry[],
      shortlistScores: [] as number[],
      shortlistedIndices: new Set<number>(),
    }
  }

  const computedLimit = Math.max(SHORTLIST_MIN, topN * SHORTLIST_MULTIPLIER)
  const shortlistLimit = Math.min(leads.length, SHORTLIST_MAX, computedLimit)

  const scorer = buildShortlistScorer(personaSpec)
  const scored = leads.map((lead, index) => {
    const { score, quality } = scoreLeadForShortlist(lead, scorer)
    return { lead, originalIndex: index, score, quality }
  })

  const shortlistScores = scored.map((entry) => entry.score)

  if (leads.length <= shortlistLimit) {
    return {
      entries: scored,
      shortlistScores,
      shortlistedIndices: new Set(scored.map((entry) => entry.originalIndex)),
    }
  }

  const sorted = [...scored].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    if (a.quality !== b.quality) return b.quality - a.quality
    return a.originalIndex - b.originalIndex
  })

  const entries = sorted.slice(0, shortlistLimit)
  const shortlistedIndices = new Set(entries.map((entry) => entry.originalIndex))

  return { entries, shortlistScores, shortlistedIndices }
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

type AxisScores = {
  role?: number
  seniority?: number
  industry?: number
  size?: number
  data_quality?: number
}

type ParsedLeadScores = {
  scores: Array<number | null>
  axisScores: Array<AxisScores | null>
  parsedCount: number
}

function parseLeadScores(text: string, count: number): ParsedLeadScores {
  const scores: Array<number | null> = Array.from(
    { length: count },
    (): number | null => null
  )
  const axisScores: Array<AxisScores | null> = Array.from(
    { length: count },
    (): AxisScores | null => null
  )
  let parsedCount = 0
  const payload = extractJsonPayload(text)
  if (!payload) return { scores, axisScores, parsedCount }

  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return { scores, axisScores, parsedCount }
  }

  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { items?: unknown }).items)
      ? (parsed as { items: unknown[] }).items
      : null

  if (!items) return { scores, axisScores, parsedCount }

  for (const item of items) {
    if (!item || typeof item !== "object") continue
    const typed = item as Partial<LeadScoreItem>
    const index = Number(typed.index)
    const final =
      Number.isFinite(typed.final) ? Number(typed.final) : undefined
    const legacyScore =
      Number.isFinite(typed.score) ? Number(typed.score) : undefined
    const derived = computeFinalScore(typed.scores)
    const scoreValue =
      final ?? legacyScore ?? (derived !== null ? derived : undefined)
    const score = Number(scoreValue)
    if (!Number.isFinite(index) || index < 0 || index >= count) continue
    if (!Number.isFinite(score)) continue
    scores[index] = clampScore(score)
    // Store axis scores if provided
    if (typed.scores) {
      axisScores[index] = {
        role: typed.scores.role,
        seniority: typed.scores.seniority,
        industry: typed.scores.industry,
        size: typed.scores.size,
        data_quality: typed.scores.data_quality,
      }
    }
    parsedCount += 1
  }

  return { scores, axisScores, parsedCount }
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
      confidence: number
      axis_scores: AxisScores | null
      needs_review: boolean
    }> = []
    const companyResults: CompanyResults[] = []

    // Check for abort before starting the main ranking loop
    checkAborted(signal)

    // Helper to process a single company
    const processCompany = async (
      companyId: string,
      companyLeads: LeadRow[]
    ): Promise<{
      companyId: string
      companyName: string
      rankedLeads: RankedLead[]
      rankingRows: typeof allRankingRows
    } | null> => {
      checkAborted(signal)

      const companyName = companyLeads[0]?.company.name ?? "Unknown"
      if (companyLeads.length === 0) return null

      const {
        entries: shortlistEntries,
        shortlistScores,
        shortlistedIndices,
      } = buildShortlist(companyLeads, personaSpec, topN)

      const scoreTotals = Array.from({ length: companyLeads.length }, () => 0)
      const scoreCounts = Array.from({ length: companyLeads.length }, () => 0)
      const leadAxisScores: Array<AxisScores | null> = Array.from(
        { length: companyLeads.length },
        () => null
      )
      // Adaptive pass count: skip multi-pass for small shortlists (threshold: 20 leads)
      const passCount = shortlistEntries.length <= 20 ? 1 : Math.max(1, RERANK_PASSES)

      // Check cache before making LLM calls
      const cacheKey = generateCacheKey(
        personaSpec,
        companyId,
        companyLeads.map((l) => ({
          id: l.id,
          title: l.title,
          full_name: l.full_name,
        }))
      )
      const personaHash = generatePersonaHash(personaSpec)
      const cached = await checkRankingCache(supabase, cacheKey, companyId)

      let usedCache = false
      if (cached) {
        usedCache = true
        companyLeads.forEach((lead, index) => {
          const cachedScore = cached.scores.get(lead.id)
          if (cachedScore) {
            scoreTotals[index] = cachedScore.score
            scoreCounts[index] = 1
            leadAxisScores[index] = cachedScore.axisScores
          }
        })
      } else {
        for (let passIndex = 0; passIndex < passCount; passIndex += 1) {
          const orderedEntries =
            passIndex === 0
              ? shortlistEntries
              : passIndex === 1
                ? [...shortlistEntries].reverse()
                : [
                    ...shortlistEntries.slice(passIndex % shortlistEntries.length),
                    ...shortlistEntries.slice(
                      0,
                      passIndex % shortlistEntries.length
                    ),
                  ]

          const orderedLeads = orderedEntries.map((entry) => entry.lead)
          if (orderedLeads.length === 0) continue

          const prompt = buildLeadScoringPrompt(activeRankingPrompt, {
            personaQuery: query,
            companyName,
            leads: orderedLeads,
          })

          let rankResult: Awaited<ReturnType<typeof generateText>>
          try {
            rankResult = await generateText({
              model: rankModel,
              prompt,
              temperature: 0,
              output: buildLeadScoreOutput(),
              providerOptions: getResponseHealingOptions(),
              abortSignal: signal,
            })
          } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
              throw error
            }
            console.warn(
              "Lead scoring with structured outputs failed; retrying without response format.",
              error instanceof Error ? error.message : error
            )
            rankResult = await generateText({
              model: rankModel,
              prompt,
              temperature: 0,
              abortSignal: signal,
            })
          }

          const { scores, axisScores, parsedCount } = parseLeadScores(
            rankResult.text,
            orderedLeads.length
          )
          if (parsedCount === 0) {
            console.warn(
              "Lead scoring output could not be parsed; defaulting to zero scores.",
              { companyId, companyName, passIndex: passIndex + 1 }
            )
          } else {
            scores.forEach((score, localIndex) => {
              if (score === null) return
              const originalIndex = orderedEntries[localIndex]?.originalIndex
              if (originalIndex === undefined) return
              scoreTotals[originalIndex] += score
              scoreCounts[originalIndex] += 1
              if (axisScores[localIndex]) {
                leadAxisScores[originalIndex] = axisScores[localIndex]
              }
            })
          }

          const providerMeta = rankResult.providerMetadata as
            | OpenRouterUsageMetadata
            | undefined
          const openrouterUsage = providerMeta?.openrouter?.usage ?? null
          const costUsd =
            typeof openrouterUsage?.cost === "number"
              ? openrouterUsage.cost
              : computeGenerationCost(rankResult.usage)

          // Record AI call (fire and forget to not slow down parallel processing)
          recordAiCall(supabase, {
            run_id: run.id,
            provider: "openrouter",
            model: rankResult.response?.modelId ?? DEFAULT_RANK_MODEL,
            operation: "rank",
            input_tokens: rankResult.usage?.inputTokens ?? null,
            output_tokens: rankResult.usage?.outputTokens ?? null,
            total_tokens: rankResult.usage?.totalTokens ?? null,
            documents_count: orderedLeads.length,
            cost_usd: costUsd,
            metadata: {
              companyId,
              companyName: companyLeads[0]?.company.name ?? null,
              openrouterUsage: openrouterUsage ?? null,
              pass: passIndex + 1,
              passes: passCount,
              shortlistCount: shortlistEntries.length,
              leadCount: companyLeads.length,
            },
          }).catch(() => {})
        }
      }

      const scores = scoreTotals.map((total, index) =>
        scoreCounts[index] > 0 ? total / scoreCounts[index] : null
      )

      if (!usedCache) {
        const cacheResults = companyLeads.map((lead, index) => ({
          leadId: lead.id,
          score: scores[index] ?? 0,
          axisScores: leadAxisScores[index],
        }))
        storeRankingCache(
          supabase,
          cacheKey,
          companyId,
          personaHash,
          cacheResults
        ).catch((err) =>
          console.warn("Failed to store ranking cache:", err)
        )
      }

      const sorted = scores
        .map((score, index) => ({
          score,
          shortlistScore: shortlistScores[index] ?? 0,
          originalIndex: index,
        }))
        .sort((a, b) => {
          const scoreA = a.score ?? -1
          const scoreB = b.score ?? -1
          if (scoreB !== scoreA) return scoreB - scoreA
          if (b.shortlistScore !== a.shortlistScore) return b.shortlistScore - a.shortlistScore
          return a.originalIndex - b.originalIndex
        })

      let relevantRank = 1
      const rankedLeads: RankedLead[] = []
      const rankingRows: typeof allRankingRows = []

      sorted.forEach((item, index) => {
        const lead = companyLeads[item.originalIndex]
        if (!lead) return
        const score = item.score ?? null
        const isRelevant = score !== null && score >= minScore
        const selected = isRelevant && relevantRank <= topN

        if (isRelevant) relevantRank += 1

        const reason = buildHeuristicReason({
          title: lead.title,
          companyName,
          personaSpec,
          isRelevant,
          shortlisted: shortlistedIndices.has(item.originalIndex),
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

        const axisScoresForLead = leadAxisScores[item.originalIndex]
        const { confidence, needsReview } = calculateConfidence(
          score,
          axisScoresForLead
        )

        rankingRows.push({
          run_id: run.id,
          lead_id: lead.id,
          company_id: companyId,
          score,
          relevance: isRelevant ? "relevant" : "irrelevant",
          rank: index + 1,
          selected,
          reason,
          confidence,
          axis_scores: axisScoresForLead,
          needs_review: needsReview,
        })
      })

      return { companyId, companyName, rankedLeads, rankingRows }
    }

    // Process companies with streaming concurrency (start new work as slots free up)
    const companyEntries = Array.from(grouped.entries())
    let nextIndex = 0
    let startedCount = 0
    let finishedCount = 0

    const processWithSlot = async (): Promise<void> => {
      while (nextIndex < companyEntries.length) {
        checkAborted(signal)

        const currentIndex = nextIndex
        nextIndex += 1
        startedCount += 1

        const [companyId, companyLeads] = companyEntries[currentIndex]!
        const companyName = companyLeads[0]?.company.name ?? "Unknown"

        await emit({
          type: "company_start",
          runId: run.id,
          companyId,
          companyName,
          index: startedCount,
          total: totalCompanies,
        })

        const result = await processCompany(companyId, companyLeads)

        if (result) {
          allRankingRows.push(...result.rankingRows)
          companyResults.push({
            companyId: result.companyId,
            companyName: result.companyName,
            leads: result.rankedLeads,
          })

          finishedCount += 1
          await emit({
            type: "company_result",
            runId: run.id,
            company: {
              companyId: result.companyId,
              companyName: result.companyName,
              leads: result.rankedLeads,
            },
            completed: finishedCount,
            total: totalCompanies,
          })
        } else {
          finishedCount += 1
        }
      }
    }

    // Start parallel workers that each process companies sequentially
    const workerCount = Math.min(PARALLEL_COMPANIES, companyEntries.length)
    await Promise.all(
      Array.from({ length: workerCount }, () => processWithSlot())
    )

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
      completed: companyResults.length,
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

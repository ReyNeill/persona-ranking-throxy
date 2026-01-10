import fs from "node:fs"
import process from "node:process"
import dotenv from "dotenv"
import { parse } from "csv-parse/sync"
import { generateText } from "ai"
import { createClient } from "@supabase/supabase-js"

import { buildLeadScoreOutput } from "@/lib/ai/lead-score-output"
import { getOpenRouterModel } from "@/lib/ai/openrouter"
import {
  DEFAULT_PERSONA_QUERY_PROMPT,
  renderPersonaQueryPrompt,
} from "@/lib/prompts/persona-query"
import {
  DEFAULT_RANKING_PROMPT,
  RANKING_PROMPT_PLACEHOLDERS,
  renderRankingPrompt,
} from "@/lib/prompts/ranking-prompt"

type EvalLead = {
  fullName: string
  title: string | null
  company: string
  linkedinUrl: string | null
  employeeRange: string | null
  rank: number | null
}

type CompanyGroup = {
  company: string
  leads: EvalLead[]
}

type EvalMetrics = {
  ndcg: number
  mrr: number
  precision: number
  top1: number
}

type PromptLeaderboardEntry = {
  prompt: string
  score: number
  trainMetrics: EvalMetrics
  testMetrics: EvalMetrics
  query: string
  errorSummary: string
}

type PromptLeaderboard = {
  objective: string
  k: number
  updatedAt: string
  queryModelId: string
  optimizerModelId: string
  rankModelId: string
  evalPath: string
  personaPath: string
  entries: PromptLeaderboardEntry[]
}

type FailureExample = {
  company: string
  expectedTop: EvalLead
  predictedTop: EvalLead
}

type PromptEvaluation = {
  prompt: string
  query: string
  trainMetrics: EvalMetrics
  testMetrics: EvalMetrics
  failures: FailureExample[]
  errorSummary: string
}

type UsageTotals = {
  calls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
  missingCost: number
}

type CompanyScoreResult = {
  company: string
  metrics: EvalMetrics
  predictedTop: EvalLead | null
  expectedTop: EvalLead | null
}

const envPath = fs.existsSync(".env.local") ? ".env.local" : ".env"
dotenv.config({ path: envPath })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_KEY

// Silence AI SDK compatibility warnings during optimization runs
if (typeof globalThis !== "undefined") {
  ;(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false
}

function getArgValue(flag: string) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

function getArgNumber(flag: string, fallback: number | null) {
  const value = getArgValue(flag)
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const evalPath = getArgValue("--eval") ?? "context/eval_set.csv"
const personaPath = getArgValue("--persona") ?? "context/persona_spec.md"
const rounds = getArgNumber("--rounds", 3) ?? 3
const candidatesPerRound = getArgNumber("--candidates", 4) ?? 4
const beamSize = getArgNumber("--beam", 3) ?? 3
const maxCompanies = getArgNumber("--max-companies", null)
const metricK = getArgNumber("--k", 10) ?? 10
const mutationsPerRound = getArgNumber("--mutations", 2) ?? 2
const foldsInput = getArgNumber("--folds", 5) ?? 5
const concurrencyInput = getArgNumber("--concurrency", 3) ?? 3
const logEveryInput = getArgNumber("--log-every", 1) ?? 1
const progressEnabled = !process.argv.includes("--no-progress")
const seed = getArgNumber("--seed", Date.now()) ?? Date.now()
const objective =
  (getArgValue("--objective") ?? "precision").toLowerCase() ?? "precision"
const budgetUsd = Number.parseFloat(getArgValue("--budget-usd") ?? "")
const forceRun = process.argv.includes("--force")
const dryRun = process.argv.includes("--dry-run")
const debug = process.argv.includes("--debug")
const testPromptPath = getArgValue("--test-prompt")
const testPromptOnly = testPromptPath !== null
const includeEmployeeRange =
  process.argv.includes("--include-employee-range") ||
  process.env.INCLUDE_EMPLOYEE_RANGE === "true"

const queryModelId =
  getArgValue("--query-model") ??
  process.env.OPENROUTER_MODEL ??
  "openai/gpt-oss-120b"
const optimizerModelId = getArgValue("--optimizer-model") ?? queryModelId
const rankModelId =
  process.env.OPENROUTER_RANK_MODEL ??
  process.env.OPENROUTER_MODEL ??
  "openai/gpt-oss-120b"

const DIRECT_QUERY = "__DIRECT_PERSONA_SPEC__"

const OUTPUT_LINE_VARIANTS = [
  "Return ONLY a JSON array of scores, no extra text.",
  "Output JSON only: [{\"index\":0,\"score\":0.5}].",
  "Respond with the JSON array only. No prose or bullets.",
  "Return only the JSON array of {index, score} objects.",
]

const EMPHASIS_LINES = [
  "Score higher for senior outbound owners and revenue leaders.",
  "Penalize marketing, finance, HR, product, and engineering roles.",
  "Prefer decision-makers accountable for pipeline and outbound execution.",
  "Disqualify roles outside the persona's target function or seniority.",
]

// Type for the model parameter expected by generateText
type GenerateTextModel = Parameters<typeof generateText>[0]["model"]

type OpenRouterUsageMetadata = {
  openrouter?: {
    usage?: {
      cost?: number
      prompt_tokens?: number
      completion_tokens?: number
      total_tokens?: number
    }
  }
}

let queryModel: GenerateTextModel | null = null
let optimizerModel: GenerateTextModel | null = null
let rankModel: GenerateTextModel | null = null

const usageTotals: UsageTotals = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cost: 0,
  missingCost: 0,
}

const personaSpec = fs.readFileSync(personaPath, "utf8").trim()

function parseEvalSet(csvText: string): CompanyGroup[] {
  const rows = parse(csvText, {
    relax_column_count: true,
    skip_empty_lines: true,
  }) as string[][]

  const dataRows = rows.slice(1)
  const groups = new Map<string, EvalLead[]>()

  for (const row of dataRows) {
    const fullName = row[0]?.trim()
    const title = row[1]?.trim()
    const company = row[2]?.trim()
    const linkedinUrl = row[3]?.trim()
    const employeeRange = row[4]?.trim()
    const rankRaw = row[5]?.trim()

    if (!company) continue

    const rank = rankRaw && rankRaw !== "-" ? Number(rankRaw) : null

    const lead: EvalLead = {
      fullName: fullName || "Unknown",
      title: title || null,
      company,
      linkedinUrl: linkedinUrl || null,
      employeeRange: employeeRange || null,
      rank: Number.isFinite(rank) ? rank : null,
    }

    const list = groups.get(company) ?? []
    list.push(lead)
    groups.set(company, list)
  }

  return Array.from(groups.entries()).map(([company, leads]) => ({
    company,
    leads,
  }))
}

function formatLeadText(lead: EvalLead) {
  const parts = [
    lead.fullName ? `Name: ${lead.fullName}` : null,
    lead.title ? `Title: ${lead.title}` : null,
    `Company: ${lead.company}`,
    includeEmployeeRange && lead.employeeRange
      ? `Employee Range: ${lead.employeeRange}`
      : null,
    lead.linkedinUrl ? `LinkedIn: ${lead.linkedinUrl}` : null,
  ].filter(Boolean)

  return parts.join(" | ")
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

function recordUsage(result: Awaited<ReturnType<typeof generateText>>) {
  const usage = result.usage
  const providerMeta = result.providerMetadata as
    | OpenRouterUsageMetadata
    | undefined
  const openrouterUsage = providerMeta?.openrouter?.usage

  const inputTokens =
    usage?.inputTokens ?? openrouterUsage?.prompt_tokens ?? 0
  const outputTokens =
    usage?.outputTokens ?? openrouterUsage?.completion_tokens ?? 0
  const totalTokens =
    usage?.totalTokens ??
    openrouterUsage?.total_tokens ??
    inputTokens + outputTokens

  usageTotals.calls += 1
  usageTotals.inputTokens += inputTokens
  usageTotals.outputTokens += outputTokens
  usageTotals.totalTokens += totalTokens

  if (typeof openrouterUsage?.cost === "number") {
    usageTotals.cost += openrouterUsage.cost
  } else {
    usageTotals.missingCost += 1
  }
}

function buildLeadScoringPrompt(
  promptTemplate: string,
  payload: {
    personaQuery: string
    companyName: string
    leads: EvalLead[]
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
): { scores: Array<number | null>; parsedCount: number } {
  const scores: Array<number | null> = Array.from(
    { length: count },
    (): number | null => null
  )
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
    parsedCount += 1
  }

  return { scores, parsedCount }
}

function mulberry32(seedValue: number) {
  let t = seedValue
  return () => {
    t += 0x6d2b79f5
    let result = Math.imul(t ^ (t >>> 15), t | 1)
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61)
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296
  }
}

function sampleCompanies(companies: CompanyGroup[]) {
  if (!maxCompanies || maxCompanies >= companies.length) return companies
  const rng = mulberry32(seed)
  const shuffled = [...companies]
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled.slice(0, maxCompanies)
}

function buildFolds(companies: CompanyGroup[], folds: number) {
  const count = companies.length
  if (count <= 1) {
    return [
      {
        train: companies,
        test: [],
      },
    ]
  }

  const safeFolds = Math.max(2, Math.min(folds, count))
  const rng = mulberry32(seed + 41)
  const shuffled = [...companies]
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  const buckets: CompanyGroup[][] = Array.from({ length: safeFolds }, () => [])
  shuffled.forEach((company, index) => {
    buckets[index % safeFolds].push(company)
  })

  return buckets.map((test, index) => {
    const train = buckets
      .filter((_bucket, bucketIndex) => bucketIndex !== index)
      .flat()
    return { train, test }
  })
}

function dcg(relevances: number[], k: number) {
  let total = 0
  const limit = Math.min(k, relevances.length)
  for (let i = 0; i < limit; i += 1) {
    const rel = relevances[i] ?? 0
    const gain = Math.pow(2, rel) - 1
    total += gain / Math.log2(i + 2)
  }
  return total
}

function scoreObjective(metrics: EvalMetrics) {
  switch (objective) {
    case "mrr":
      return metrics.mrr
    case "precision":
      return metrics.precision
    case "top1":
      return metrics.top1
    case "ndcg":
    default:
      return metrics.ndcg
  }
}

function renderLeadLabel(lead: EvalLead | undefined) {
  if (!lead) return "unknown"
  if (lead.title) {
    return `${lead.fullName} (${lead.title})`
  }
  return lead.fullName
}

function generateHeuristicMutations(
  promptTemplate: string | undefined,
  count: number,
  rng: () => number
) {
  if (!promptTemplate) return []
  const required = Object.values(RANKING_PROMPT_PLACEHOLDERS)
  if (!required.every((placeholder) => promptTemplate.includes(placeholder))) return []
  if (count <= 0) return []

  const lines = promptTemplate.split("\n")
  const outputIndex = lines.findIndex((line) =>
    /json|return only|output only|respond with/i.test(line)
  )
  const placeholderIndex = lines.findIndex((line) =>
    line.includes(RANKING_PROMPT_PLACEHOLDERS.PERSONA_QUERY)
  )

  const mutations = new Set<string>()

  for (const variant of OUTPUT_LINE_VARIANTS) {
    const next = [...lines]
    if (outputIndex >= 0) {
      next[outputIndex] = variant
    } else if (placeholderIndex >= 0) {
      next.splice(placeholderIndex, 0, variant)
    } else {
      next.push(variant)
    }
    mutations.add(next.join("\n"))
  }

  for (const emphasis of EMPHASIS_LINES) {
    const next = [...lines]
    if (placeholderIndex >= 0) {
      next.splice(placeholderIndex, 0, emphasis)
    } else {
      next.push(emphasis)
    }
    mutations.add(next.join("\n"))
  }

  const all = Array.from(mutations)
  for (let i = all.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    ;[all[i], all[j]] = [all[j], all[i]]
  }

  return all.slice(0, Math.min(count, all.length))
}

function summarizePrompt(promptTemplate: string) {
  const firstLine = promptTemplate
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (!firstLine) return "prompt"
  return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine
}

function categorizeFunction(title: string | null) {
  if (!title) return "unknown"
  const normalized = title.toLowerCase()
  if (normalized.includes("sales development") || normalized.includes("sdr") || normalized.includes("bdr")) {
    return "sales-development"
  }
  if (normalized.includes("revenue operations") || normalized.includes("revops") || normalized.includes("sales ops")) {
    return "revops"
  }
  if (normalized.includes("growth") || normalized.includes("gtm") || normalized.includes("go-to-market")) {
    return "growth"
  }
  if (normalized.includes("marketing")) return "marketing"
  if (normalized.includes("business development")) return "business-development"
  if (normalized.includes("sales") || normalized.includes("account executive") || normalized.includes("ae")) {
    return "sales"
  }
  if (normalized.includes("customer success") || normalized.includes("support")) {
    return "customer-success"
  }
  if (normalized.includes("finance") || normalized.includes("cfo") || normalized.includes("fp&a") || normalized.includes("accountant")) {
    return "finance"
  }
  if (normalized.includes("engineering") || normalized.includes("engineer") || normalized.includes("developer") || normalized.includes("cto")) {
    return "engineering"
  }
  if (normalized.includes("product")) return "product"
  if (normalized.includes("hr") || normalized.includes("people") || normalized.includes("talent") || normalized.includes("recruit")) {
    return "people"
  }
  return "other"
}

function categorizeSeniority(title: string | null) {
  if (!title) return "unknown"
  const normalized = title.toLowerCase()
  if (normalized.includes("founder") || normalized.includes("co-founder") || normalized.includes("owner")) {
    return "founder"
  }
  if (normalized.includes("ceo") || normalized.includes("president") || normalized.includes("chief")) {
    return "c-level"
  }
  if (normalized.includes("vp") || normalized.includes("vice president")) {
    return "vp"
  }
  if (normalized.includes("head of") || normalized.startsWith("head ")) {
    return "head"
  }
  if (normalized.includes("director")) return "director"
  if (normalized.includes("manager")) return "manager"
  return "ic"
}

function summarizeFailures(failures: FailureExample[]) {
  if (failures.length === 0) return ""

  const funcMismatch = new Map<string, number>()
  const seniorityMismatch = new Map<string, number>()

  for (const failure of failures) {
    const expectedFunc = categorizeFunction(failure.expectedTop.title)
    const predictedFunc = categorizeFunction(failure.predictedTop.title)
    if (expectedFunc !== predictedFunc) {
      const key = `${predictedFunc} -> ${expectedFunc}`
      funcMismatch.set(key, (funcMismatch.get(key) ?? 0) + 1)
    }

    const expectedSeniority = categorizeSeniority(failure.expectedTop.title)
    const predictedSeniority = categorizeSeniority(failure.predictedTop.title)
    if (expectedSeniority !== predictedSeniority) {
      const key = `${predictedSeniority} -> ${expectedSeniority}`
      seniorityMismatch.set(key, (seniorityMismatch.get(key) ?? 0) + 1)
    }
  }

  const topFunc = Array.from(funcMismatch.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label, count]) => `${label} (${count})`)

  const topSeniority = Array.from(seniorityMismatch.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label, count]) => `${label} (${count})`)

  const summaryLines = ["Common error patterns:"]
  if (topFunc.length > 0) {
    summaryLines.push(`Function mismatch: ${topFunc.join(", ")}`)
  }
  if (topSeniority.length > 0) {
    summaryLines.push(`Seniority mismatch: ${topSeniority.join(", ")}`)
  }
  if (summaryLines.length === 1) return ""

  return summaryLines.join("\n")
}

async function buildQuery(promptTemplate: string) {
  if (promptTemplate === DIRECT_QUERY) return personaSpec
  if (!queryModel) throw new Error("Query model not initialized")
  const prompt = renderPersonaQueryPrompt(promptTemplate, personaSpec)
  const result = await generateText({
    model: queryModel,
    prompt,
  })
  recordUsage(result)
  const cleaned = result.text.trim()
  return cleaned.length > 0 ? cleaned : personaSpec
}

async function getActivePersonaQueryPrompt(): Promise<string | null> {
  if (!supabaseUrl || !serviceRoleKey) return null
  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    })
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


async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return []
  const safeLimit = Math.max(1, Math.min(limit, items.length))
  const results = new Array<R>(items.length)
  let nextIndex = 0

  await Promise.all(
    Array.from({ length: safeLimit }, async () => {
      while (nextIndex < items.length) {
        const current = nextIndex
        nextIndex += 1
        results[current] = await worker(items[current], current)
      }
    })
  )

  return results
}

async function scoreCompany(
  promptTemplate: string,
  personaQuery: string,
  company: CompanyGroup
): Promise<CompanyScoreResult> {
  if (!rankModel) throw new Error("Rank model not initialized")
  const prompt = buildLeadScoringPrompt(promptTemplate, {
    personaQuery,
    companyName: company.company,
    leads: company.leads,
  })
  let rankResult: Awaited<ReturnType<typeof generateText>>
  try {
    rankResult = await generateText({
      model: rankModel,
      prompt,
      output: buildLeadScoreOutput(),
      providerOptions: getResponseHealingOptions(),
    })
    recordUsage(rankResult)
  } catch (error) {
    console.warn(
      "Lead scoring with structured outputs failed; retrying without response format.",
      error instanceof Error ? error.message : error
    )
    rankResult = await generateText({
      model: rankModel,
      prompt,
    })
    recordUsage(rankResult)
  }

  const { scores, parsedCount } = parseLeadScores(
    rankResult.text,
    company.leads.length
  )
  if (parsedCount === 0) {
    console.warn(
      "Lead scoring output could not be parsed; defaulting to zero scores.",
      { company: company.company }
    )
    if (debug) {
      console.log("[debug] Raw lead scoring response:")
      console.log(rankResult.text)
      console.log("[debug] End raw response")
    }
  }

  const sorted = scores
    .map((score, index) => ({ score, originalIndex: index }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

  const predicted = sorted
    .map((item) => company.leads[item.originalIndex])
    .filter(Boolean)

  const ranks = company.leads
    .map((lead) => lead.rank)
    .filter((rank): rank is number => typeof rank === "number")

  const maxRank = ranks.length > 0 ? Math.max(...ranks) : 0
  const relevance = predicted.map((lead) => {
    if (!lead.rank || maxRank === 0) return 0
    return maxRank - lead.rank + 1
  })

  const idcgRelevance = [...relevance].sort((a, b) => b - a)
  const dcgValue = dcg(relevance, metricK)
  const idcgValue = dcg(idcgRelevance, metricK)
  const ndcg = idcgValue > 0 ? dcgValue / idcgValue : 0

  const topK = predicted.slice(0, metricK)
  const relevantInTopK = topK.filter((lead) => lead.rank !== null).length
  const precision = topK.length > 0 ? relevantInTopK / topK.length : 0

  const bestLead = company.leads.find((lead) => lead.rank === 1) ?? null
  let mrr = 0
  if (bestLead) {
    const index = predicted.findIndex(
      (lead) =>
        lead.fullName === bestLead.fullName && lead.title === bestLead.title
    )
    if (index >= 0) {
      mrr = 1 / (index + 1)
    }
  }

  const top1 =
    predicted[0]?.rank === 1 ||
    (bestLead &&
      predicted[0]?.fullName === bestLead.fullName &&
      predicted[0]?.title === bestLead.title)
      ? 1
      : 0

  return {
    company: company.company,
    metrics: {
      ndcg,
      mrr,
      precision,
      top1,
    },
    predictedTop: predicted[0] ?? null,
    expectedTop: bestLead,
  }
}

async function scoreCompanies(
  promptTemplate: string,
  personaQuery: string,
  companies: CompanyGroup[]
): Promise<Map<string, CompanyScoreResult>> {
  const total = companies.length
  let completed = 0
  const logEvery = Math.max(1, logEveryInput)
  const label = summarizePrompt(promptTemplate)
  if (progressEnabled) {
    console.log(`Scoring companies for prompt: "${label}" (${total} total)`)
  }
  const results = await runWithConcurrency(
    companies,
    concurrencyInput,
    async (company) => {
      const result = await scoreCompany(promptTemplate, personaQuery, company)
      completed += 1
      if (
        progressEnabled &&
        (completed % logEvery === 0 || completed === total)
      ) {
        console.log(
          `Progress: ${completed}/${total} companies scored for "${label}"`
        )
      }
      return result
    }
  )
  return new Map(results.map((result) => [result.company, result]))
}

function aggregateMetrics(
  resultsByCompany: Map<string, CompanyScoreResult>,
  companies: CompanyGroup[]
) {
  let ndcgTotal = 0
  let mrrTotal = 0
  let precisionTotal = 0
  let top1Total = 0
  let count = 0

  for (const company of companies) {
    const result = resultsByCompany.get(company.company)
    if (!result) continue
    ndcgTotal += result.metrics.ndcg
    mrrTotal += result.metrics.mrr
    precisionTotal += result.metrics.precision
    top1Total += result.metrics.top1
    count += 1
  }

  return {
    ndcg: count > 0 ? ndcgTotal / count : 0,
    mrr: count > 0 ? mrrTotal / count : 0,
    precision: count > 0 ? precisionTotal / count : 0,
    top1: count > 0 ? top1Total / count : 0,
  }
}

function collectFailures(
  resultsByCompany: Map<string, CompanyScoreResult>,
  companies: CompanyGroup[],
  limit: number
) {
  const failures: FailureExample[] = []
  for (const company of companies) {
    const result = resultsByCompany.get(company.company)
    if (!result) continue
    if (!result.expectedTop || !result.predictedTop) continue
    if (result.metrics.top1 === 1) continue
    failures.push({
      company: company.company,
      expectedTop: result.expectedTop,
      predictedTop: result.predictedTop,
    })
    if (failures.length >= limit) break
  }
  return failures
}

async function evaluatePrompt(
  promptTemplate: string,
  personaQuery: string,
  folds: Array<{ train: CompanyGroup[]; test: CompanyGroup[] }>,
  companies: CompanyGroup[]
): Promise<PromptEvaluation> {
  const resultsByCompany = await scoreCompanies(
    promptTemplate,
    personaQuery,
    companies
  )

  let trainTotals = { ndcg: 0, mrr: 0, precision: 0, top1: 0 }
  let testTotals = { ndcg: 0, mrr: 0, precision: 0, top1: 0 }

  for (const fold of folds) {
    const trainMetrics = aggregateMetrics(resultsByCompany, fold.train)
    const testMetrics = aggregateMetrics(resultsByCompany, fold.test)
    trainTotals = {
      ndcg: trainTotals.ndcg + trainMetrics.ndcg,
      mrr: trainTotals.mrr + trainMetrics.mrr,
      precision: trainTotals.precision + trainMetrics.precision,
      top1: trainTotals.top1 + trainMetrics.top1,
    }
    testTotals = {
      ndcg: testTotals.ndcg + testMetrics.ndcg,
      mrr: testTotals.mrr + testMetrics.mrr,
      precision: testTotals.precision + testMetrics.precision,
      top1: testTotals.top1 + testMetrics.top1,
    }
  }

  const foldCount = folds.length || 1
  const trainMetrics: EvalMetrics = {
    ndcg: trainTotals.ndcg / foldCount,
    mrr: trainTotals.mrr / foldCount,
    precision: trainTotals.precision / foldCount,
    top1: trainTotals.top1 / foldCount,
  }
  const testMetrics: EvalMetrics = {
    ndcg: testTotals.ndcg / foldCount,
    mrr: testTotals.mrr / foldCount,
    precision: testTotals.precision / foldCount,
    top1: testTotals.top1 / foldCount,
  }

  const failures = collectFailures(
    resultsByCompany,
    folds[0]?.train ?? companies,
    8
  )
  const errorSummary = summarizeFailures(failures)

  return {
    prompt: promptTemplate,
    query: personaQuery,
    trainMetrics,
    testMetrics,
    failures,
    errorSummary,
  }
}

function formatPromptSummary(evaluation: PromptEvaluation, index: number) {
  const score = scoreObjective(evaluation.trainMetrics)
  const metrics = evaluation.trainMetrics
  return [
    `#${index + 1} score=${score.toFixed(4)} ndcg=${metrics.ndcg.toFixed(4)} mrr=${metrics.mrr.toFixed(4)} precision=${metrics.precision.toFixed(4)} top1=${metrics.top1.toFixed(4)}`,
    evaluation.prompt,
  ].join("\n")
}

async function generateCandidatePrompts(
  topPrompts: PromptEvaluation[]
): Promise<string[]> {
  const summaries = topPrompts
    .map((evaluation, index) => formatPromptSummary(evaluation, index))
    .join("\n\n")

  const failures = topPrompts[0]?.failures ?? []
  const errorSummary = topPrompts[0]?.errorSummary ?? ""
  const failureBlock = failures.length
    ? [
        "Failure examples from the current best prompt:",
        ...failures.map(
          (failure) =>
            `- ${failure.company}: expected ${renderLeadLabel(failure.expectedTop)} but got ${renderLeadLabel(failure.predictedTop)}`
        ),
      ].join("\n")
    : ""

  const promptParts = [
    "You are optimizing a ranking prompt template that scores leads for outbound sales.",
    `The objective is to maximize ${objective.toUpperCase()} on a lead-ranking evaluation set.`,
    "Return JSON only: {\"prompts\": [\"...\"]}.",
    `Each prompt must include placeholders: ${Object.values(
      RANKING_PROMPT_PLACEHOLDERS
    ).join(", ")}.`,
    "Each prompt must instruct the model to output only a JSON array of axis scores with a final 0-1 score per lead.",
    "Avoid Markdown or code fences. Keep prompts under 1500 characters.",
    "Generate distinct prompts that improve on the top performers.",
    "",
    "Top prompts so far:",
    summaries,
  ]

  if (errorSummary) {
    promptParts.push("", "Error summary from current best prompt:", errorSummary)
  }
  if (failureBlock) {
    promptParts.push("", failureBlock)
  }

  const prompt = promptParts.join("\n")

  if (debug) {
    console.log("\n[debug] Optimizer meta-prompt:")
    console.log(prompt)
    console.log("[debug] End optimizer meta-prompt\n")
  }

  if (!optimizerModel) throw new Error("Optimizer model not initialized")
  const result = await generateText({
    model: optimizerModel,
    prompt,
  })
  recordUsage(result)

  const text = result.text.trim()
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    console.warn("Optimizer did not return JSON. Skipping this round.")
    if (debug) {
      console.log("[debug] Optimizer raw response:")
      console.log(text.slice(0, 800))
      console.log("[debug] End optimizer raw response")
    }
    return []
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { prompts?: string[] }
    const prompts = Array.isArray(parsed.prompts) ? parsed.prompts : []
    const cleaned = prompts.map((value) => value.trim()).filter(Boolean)
    if (debug) {
      console.log("[debug] Optimizer candidates:")
      cleaned.forEach((item, index) => {
        console.log(`--- candidate ${index + 1} ---`)
        console.log(item)
      })
      if (cleaned.length === 0) {
        console.log("[debug] (no candidates parsed)")
      }
      console.log("[debug] End optimizer candidates\n")
    }
    return cleaned
  } catch {
    console.warn("Failed to parse optimizer JSON. Skipping this round.")
    if (debug) {
      console.log("[debug] Optimizer raw response:")
      console.log(text.slice(0, 800))
      console.log("[debug] End optimizer raw response")
    }
    return []
  }
}

function isTemplatePrompt(promptTemplate: string) {
  if (promptTemplate === DIRECT_QUERY) return false
  return Object.values(RANKING_PROMPT_PLACEHOLDERS).every((placeholder) =>
    promptTemplate.includes(placeholder)
  )
}

function isPromptValid(promptTemplate: string) {
  const trimmed = promptTemplate.trim()
  if (trimmed.length < 20) return false
  if (!isTemplatePrompt(trimmed)) return false
  return true
}

function formatMetrics(metrics: EvalMetrics) {
  return [
    `ndcg=${metrics.ndcg.toFixed(4)}`,
    `mrr=${metrics.mrr.toFixed(4)}`,
    `precision=${metrics.precision.toFixed(4)}`,
    `top1=${metrics.top1.toFixed(4)}`,
  ].join(" ")
}

const evalCsv = fs.readFileSync(evalPath, "utf8")
const allCompanies = parseEvalSet(evalCsv)
const companies = sampleCompanies(allCompanies)
const folds = buildFolds(companies, foldsInput)

const totalDocuments = companies.reduce(
  (sum, company) => sum + company.leads.length,
  0
)

const estimatedPromptEvaluations =
  2 + Math.max(0, rounds - 1) * (candidatesPerRound + mutationsPerRound)

const estimatedTotalCost = 0

console.log(
  `Loaded ${allCompanies.length} companies (evaluating ${companies.length}).`
)
console.log(
  `Query model: ${queryModelId} | Optimizer model: ${optimizerModelId} | Rank model: ${rankModelId}`
)
const foldTestSizes = folds.map((fold) => fold.test.length)
const foldTrainSizes = folds.map((fold) => fold.train.length)
const foldSummary = foldTestSizes
  .map((testSize, index) => `${foldTrainSizes[index]}/${testSize}`)
  .join(", ")
console.log(`K-fold split: k=${folds.length} (train/test per fold: ${foldSummary})`)
console.log(
  `Estimated evaluations: ${estimatedPromptEvaluations} prompts | ${companies.length} companies | ${totalDocuments} total documents`
)
console.log(
  `Scoring concurrency: ${Math.max(1, Math.min(concurrencyInput, companies.length || 1))}`
)

console.log(
  "Estimated costs: OpenRouter spend not estimated (actual usage printed at end if enabled)."
)

if (
  Number.isFinite(budgetUsd) &&
  budgetUsd > 0 &&
  estimatedTotalCost > 0 &&
  estimatedTotalCost > budgetUsd &&
  !forceRun
) {
  console.error(
    `Estimated cost $${estimatedTotalCost.toFixed(2)} exceeds budget $${budgetUsd.toFixed(2)}.`
  )
  console.error(
    "Reduce --rounds, --candidates, --mutations, or --max-companies, or rerun with --force to proceed."
  )
  process.exit(1)
}

if (dryRun) {
  console.log("Dry run enabled. Exiting before any API calls.")
  process.exit(0)
}

if (!process.env.OPENROUTER_API_KEY) {
  console.error("Missing OPENROUTER_API_KEY for prompt optimization.")
  process.exit(1)
}

// OpenRouter SDK types don't fully match AI SDK v6 yet, but runtime is compatible
const queryModelRaw = getOpenRouterModel(queryModelId)
const optimizerModelRaw = getOpenRouterModel(optimizerModelId)
const rankModelRaw = getOpenRouterModel(rankModelId)

if (!queryModelRaw) {
  console.error("Unable to create OpenRouter model for query generation.")
  process.exit(1)
}

if (!optimizerModelRaw) {
  console.error("Unable to create OpenRouter model for prompt optimization.")
  process.exit(1)
}

if (!rankModelRaw) {
  console.error("Unable to create OpenRouter model for lead scoring.")
  process.exit(1)
}

if ((rankModelRaw as { specificationVersion?: string }).specificationVersion === "v2") {
  console.log("[ai-sdk] OpenRouter model running in v2 compatibility mode.")
}

queryModel = queryModelRaw as unknown as GenerateTextModel
optimizerModel = optimizerModelRaw as unknown as GenerateTextModel
rankModel = rankModelRaw as unknown as GenerateTextModel

const evaluations = new Map<string, PromptEvaluation>()

const personaQueryPromptTemplate =
  (await getActivePersonaQueryPrompt()) ?? DEFAULT_PERSONA_QUERY_PROMPT
const personaQuery = await buildQuery(personaQueryPromptTemplate)

async function getEvaluation(promptTemplate: string) {
  const cached = evaluations.get(promptTemplate)
  if (cached) return cached

  if (!isPromptValid(promptTemplate)) {
    console.warn(
      "Skipping invalid ranking prompt (missing required placeholders)."
    )
    return {
      prompt: promptTemplate,
      query: personaQuery,
      trainMetrics: { ndcg: 0, mrr: 0, precision: 0, top1: 0 },
      testMetrics: { ndcg: 0, mrr: 0, precision: 0, top1: 0 },
      failures: [],
      errorSummary: "Invalid ranking prompt template.",
    }
  }

  console.log("\nEvaluating prompt:")
  console.log(promptTemplate)

  const evaluation = await evaluatePrompt(
    promptTemplate,
    personaQuery,
    folds,
    companies
  )
  evaluations.set(promptTemplate, evaluation)

  console.log(
    `Train metrics: ${formatMetrics(evaluation.trainMetrics)} | Test metrics: ${formatMetrics(evaluation.testMetrics)}`
  )
  return evaluation
}

const AXIS_PROMPT_STRICT = [
  "You are ranking company contacts for outbound sales.",
  "Score each lead on these axes using integers 0-5:",
  "- role (function/title fit)",
  "- seniority (seniority fit from title)",
  "- industry (industry fit when provided)",
  "- size (company size fit when provided)",
  "- data_quality (penalize missing/conflicting fields)",
  "If a lead hits a hard exclusion or avoid rule, set role=0 and final <= 0.1.",
  "If role is a poor match to the persona, cap final <= 0.3.",
  "Compute final as the average of the 5 axes scaled to 0-1.",
  "If key fields are missing, list them in a 'missing' array.",
  "Return ONLY a JSON array in this format:",
  '[{"index":0,"final":0.82,"scores":{"role":5,"seniority":4,"industry":3,"size":4,"data_quality":5},"missing":[]}]',
  "Use every index exactly once. No extra text.",
  "",
  "Persona rubric:",
  RANKING_PROMPT_PLACEHOLDERS.PERSONA_QUERY,
  "",
  `Company: ${RANKING_PROMPT_PLACEHOLDERS.COMPANY_NAME}`,
  "",
  "Leads:",
  RANKING_PROMPT_PLACEHOLDERS.LEADS,
].join("\n")

const AXIS_PROMPT_WEIGHTED = [
  "You are ranking company contacts for outbound sales.",
  "Score each lead on these axes using integers 0-5:",
  "- role (function/title fit)",
  "- seniority (seniority fit from title)",
  "- industry (industry fit when provided)",
  "- size (company size fit when provided)",
  "- data_quality (penalize missing/conflicting fields)",
  "Compute final with heavier weight on role and seniority:",
  "final = (role*2 + seniority*2 + industry + size + data_quality) / 35.",
  "If key fields are missing, list them in a 'missing' array.",
  "Return ONLY a JSON array in this format:",
  '[{"index":0,"final":0.82,"scores":{"role":5,"seniority":4,"industry":3,"size":4,"data_quality":5},"missing":[]}]',
  "Use every index exactly once. No extra text.",
  "",
  "Persona rubric:",
  RANKING_PROMPT_PLACEHOLDERS.PERSONA_QUERY,
  "",
  `Company: ${RANKING_PROMPT_PLACEHOLDERS.COMPANY_NAME}`,
  "",
  "Leads:",
  RANKING_PROMPT_PLACEHOLDERS.LEADS,
].join("\n")

const AXIS_PROMPT_CONSERVATIVE = [
  "You are ranking company contacts for outbound sales.",
  "Score each lead on these axes using integers 0-5:",
  "- role (function/title fit)",
  "- seniority (seniority fit from title)",
  "- industry (industry fit when provided)",
  "- size (company size fit when provided)",
  "- data_quality (penalize missing/conflicting fields)",
  "Be conservative: missing title, industry, or employee range should reduce data_quality.",
  "Compute final as the average of the 5 axes scaled to 0-1.",
  "If key fields are missing, list them in a 'missing' array.",
  "Return ONLY a JSON array in this format:",
  '[{"index":0,"final":0.82,"scores":{"role":5,"seniority":4,"industry":3,"size":4,"data_quality":5},"missing":[]}]',
  "Use every index exactly once. No extra text.",
  "",
  "Persona rubric:",
  RANKING_PROMPT_PLACEHOLDERS.PERSONA_QUERY,
  "",
  `Company: ${RANKING_PROMPT_PLACEHOLDERS.COMPANY_NAME}`,
  "",
  "Leads:",
  RANKING_PROMPT_PLACEHOLDERS.LEADS,
].join("\n")

// Handle --test-prompt mode: evaluate a single prompt and exit
if (testPromptOnly && testPromptPath) {
  if (!fs.existsSync(testPromptPath)) {
    console.error(`Test prompt file not found: ${testPromptPath}`)
    process.exit(1)
  }

  const testPrompt = fs.readFileSync(testPromptPath, "utf8").trim()
  console.log("\n=== Testing Single Prompt ===")
  console.log("Prompt file:", testPromptPath)
  console.log("Prompt content:")
  console.log(testPrompt)
  console.log("\n")

  const evaluation = await getEvaluation(testPrompt)

  console.log("\n=== Results ===")
  console.log(`Train metrics: ${formatMetrics(evaluation.trainMetrics)}`)
  console.log(`Test metrics: ${formatMetrics(evaluation.testMetrics)}`)
  console.log(`Score (${objective}): ${scoreObjective(evaluation.testMetrics).toFixed(4)}`)

  if (evaluation.failures.length > 0) {
    console.log("\nFailure examples:")
    for (const failure of evaluation.failures.slice(0, 5)) {
      console.log(`  - ${failure.company}: expected ${renderLeadLabel(failure.expectedTop)} but got ${renderLeadLabel(failure.predictedTop)}`)
    }
  }

  if (evaluation.errorSummary) {
    console.log("\n" + evaluation.errorSummary)
  }

  if (usageTotals.calls > 0) {
    const costLabel = usageTotals.cost > 0 ? `${usageTotals.cost.toFixed(4)} credits` : "not available"
    console.log(`\nUsage: calls=${usageTotals.calls} tokens=${usageTotals.totalTokens} cost=${costLabel}`)
  }

  process.exit(0)
}

const baselinePrompts = [
  DEFAULT_RANKING_PROMPT,
  AXIS_PROMPT_STRICT,
  AXIS_PROMPT_WEIGHTED,
  AXIS_PROMPT_CONSERVATIVE,
]

for (const promptTemplate of baselinePrompts) {
  await getEvaluation(promptTemplate)
}

let population = [...baselinePrompts]

for (let round = 0; round < rounds; round += 1) {
  console.log(`\nRound ${round + 1} of ${rounds}`)

  for (const promptTemplate of population) {
    await getEvaluation(promptTemplate)
  }

  const scored = Array.from(evaluations.values())
    .filter((evaluation) => isTemplatePrompt(evaluation.prompt))
    .sort(
      (a, b) =>
        scoreObjective(b.trainMetrics) - scoreObjective(a.trainMetrics)
    )

  const topPrompts = scored.slice(0, beamSize)

  console.log("\nTop prompts so far:")
  topPrompts.forEach((evaluation, index) => {
    console.log(formatPromptSummary(evaluation, index))
    console.log("---")
  })

  if (round === rounds - 1) {
    population = topPrompts.map((evaluation) => evaluation.prompt)
    break
  }

  const candidatePrompts = await generateCandidatePrompts(topPrompts)
  const mutationRng = mulberry32(seed + round + 73)
  const heuristicMutations = generateHeuristicMutations(
    topPrompts[0]?.prompt,
    mutationsPerRound,
    mutationRng
  )
  if (debug && heuristicMutations.length > 0) {
    console.log("[debug] Heuristic mutations:")
    heuristicMutations.forEach((item, index) => {
      console.log(`--- mutation ${index + 1} ---`)
      console.log(item)
    })
    console.log("[debug] End heuristic mutations\n")
  }
  const filtered = [...candidatePrompts, ...heuristicMutations].filter(
    isPromptValid
  )
  const unique = Array.from(new Set(filtered))
  const nextPopulation = [...topPrompts.map((evaluation) => evaluation.prompt)]

  for (const candidate of unique) {
    if (nextPopulation.length >= beamSize + candidatesPerRound) break
    nextPopulation.push(candidate)
  }

  if (nextPopulation.length === 0) {
    console.warn("No valid candidates generated. Ending early.")
    break
  }

  population = nextPopulation
}

const finalScored = Array.from(evaluations.values())
  .filter((evaluation) => isTemplatePrompt(evaluation.prompt))
  .sort(
    (a, b) => scoreObjective(b.trainMetrics) - scoreObjective(a.trainMetrics)
  )

const best = finalScored[0]
if (!best) {
  console.error("No prompts evaluated successfully.")
  process.exit(1)
}

console.log("\nBest prompt template:")
console.log(best.prompt)
console.log(
  `Best train metrics: ${formatMetrics(best.trainMetrics)} | Best test metrics: ${formatMetrics(best.testMetrics)}`
)
console.log("Persona rubric used:")
console.log(best.query)

const leaderboardEntries: PromptLeaderboardEntry[] = finalScored
  .slice(0, 20)
  .map((evaluation) => ({
    prompt: evaluation.prompt,
    score: scoreObjective(evaluation.testMetrics),
    trainMetrics: evaluation.trainMetrics,
    testMetrics: evaluation.testMetrics,
    query: evaluation.query,
    errorSummary: evaluation.errorSummary,
  }))

const leaderboard: PromptLeaderboard = {
  objective,
  k: metricK,
  updatedAt: new Date().toISOString(),
  queryModelId,
  optimizerModelId,
  rankModelId,
  evalPath,
  personaPath,
  entries: leaderboardEntries,
}

if (supabaseUrl && serviceRoleKey) {
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  const { error } = await supabase.from("prompt_leaderboards").upsert({
    id: "active",
    data: leaderboard,
    updated_at: new Date().toISOString(),
  })
  if (error) {
    console.warn("Unable to write prompt leaderboard to Supabase:", error.message)
  } else {
    console.log("\nSaved prompt leaderboard to Supabase.")
  }
} else {
  console.warn(
    "Skipping prompt leaderboard write (missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY)."
  )
}

if (usageTotals.calls > 0) {
  const totalTokens =
    usageTotals.totalTokens || usageTotals.inputTokens + usageTotals.outputTokens
  const costLabel =
    usageTotals.cost > 0 ? `${usageTotals.cost.toFixed(4)} credits` : "not available"
  console.log(
    `\nActual usage: calls=${usageTotals.calls} input_tokens=${usageTotals.inputTokens} output_tokens=${usageTotals.outputTokens} total_tokens=${totalTokens} cost=${costLabel}`
  )
  if (usageTotals.missingCost > 0) {
    console.log(
      `Cost missing for ${usageTotals.missingCost} call(s). Enable OpenRouter usage accounting to include cost.`
    )
  }
}

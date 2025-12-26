import fs from "node:fs"
import process from "node:process"
import dotenv from "dotenv"
import { parse } from "csv-parse/sync"
import { generateText, rerank } from "ai"
import { cohere } from "@ai-sdk/cohere"

import { getOpenRouterModel } from "@/lib/ai/openrouter"
import {
  DEFAULT_PERSONA_QUERY_PROMPT,
  PERSONA_SPEC_PLACEHOLDER,
  renderPersonaQueryPrompt,
} from "@/lib/prompts/persona-query"

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

type CompanyMetrics = {
  ndcg: number
  mrr: number
  precision: number
  top1: number
}

type EvalMetrics = {
  ndcg: number
  mrr: number
  precision: number
  top1: number
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

const envPath = fs.existsSync(".env.local") ? ".env.local" : ".env"
dotenv.config({ path: envPath })

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
const trainRatioInput = Number.parseFloat(
  getArgValue("--train-ratio") ?? "0.8"
)
const seed = getArgNumber("--seed", Date.now()) ?? Date.now()
const outputPath = getArgValue("--output")
const objective =
  (getArgValue("--objective") ?? "precision").toLowerCase() ?? "precision"
const budgetUsd = Number.parseFloat(getArgValue("--budget-usd") ?? "")
const forceRun = process.argv.includes("--force")
const dryRun = process.argv.includes("--dry-run")
const debug = process.argv.includes("--debug")
const includeEmployeeRange =
  process.argv.includes("--include-employee-range") ||
  process.env.INCLUDE_EMPLOYEE_RANGE === "true"
const queryInputTokensOverride = getArgNumber("--query-input-tokens", null)
const queryOutputTokensOverride = getArgNumber("--query-output-tokens", null)
const optimizerInputTokensOverride = getArgNumber("--optimizer-input-tokens", null)
const optimizerOutputTokensOverride = getArgNumber("--optimizer-output-tokens", null)

const queryModelId =
  getArgValue("--query-model") ??
  process.env.OPENROUTER_MODEL ??
  "openai/gpt-4o-mini"
const optimizerModelId =
  getArgValue("--optimizer-model") ??
  process.env.PROMPT_OPTIMIZER_MODEL ??
  queryModelId
const rerankModelId = process.env.RERANK_MODEL ?? "rerank-v3.5"

const DIRECT_PROMPT = "__DIRECT_PERSONA_SPEC__"

const OUTPUT_LINE_VARIANTS = [
  "Return only the query text, no bullets.",
  "Output only the rewritten query text.",
  "Respond with a single-paragraph query, nothing else.",
  "Only return the query. No lists or commentary.",
]

const EMPHASIS_LINES = [
  "Focus on sales leadership and outbound owners; disqualify non-sales roles.",
  "Explicitly prioritize sales development leadership and revenue owners.",
  "Prefer decision-makers accountable for pipeline and outbound execution.",
  "Explicitly exclude marketing, finance, HR, product, and engineering leaders.",
]

let queryModel: ReturnType<typeof getOpenRouterModel> | null = null
let optimizerModel: ReturnType<typeof getOpenRouterModel> | null = null

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

function mulberry32(seedValue: number) {
  let t = seedValue
  return () => {
    t += 0x6d2b79f5
    let result = Math.imul(t ^ (t >>> 15), t | 1)
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61)
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296
  }
}

function estimateTokens(text: string) {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
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

function splitCompanies(companies: CompanyGroup[]) {
  if (companies.length <= 1) {
    return { train: companies, test: [] }
  }

  const ratio = Number.isFinite(trainRatioInput)
    ? Math.min(Math.max(trainRatioInput, 0.1), 0.9)
    : 0.8
  const rng = mulberry32(seed + 41)
  const shuffled = [...companies]
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  const splitIndex = Math.min(
    shuffled.length - 1,
    Math.max(1, Math.floor(shuffled.length * ratio))
  )
  return {
    train: shuffled.slice(0, splitIndex),
    test: shuffled.slice(splitIndex),
  }
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
  if (!promptTemplate.includes(PERSONA_SPEC_PLACEHOLDER)) return []
  if (count <= 0) return []

  const lines = promptTemplate.split("\n")
  const outputIndex = lines.findIndex((line) =>
    /return only|output only|respond with/i.test(line)
  )
  const placeholderIndex = lines.findIndex((line) =>
    line.includes(PERSONA_SPEC_PLACEHOLDER)
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
  if (promptTemplate === DIRECT_PROMPT) return personaSpec
  const prompt = renderPersonaQueryPrompt(promptTemplate, personaSpec)
  const result = await generateText({
    model: queryModel as any,
    prompt,
  })
  const cleaned = result.text.trim()
  return cleaned.length > 0 ? cleaned : personaSpec
}

async function evaluateOnCompanies(
  query: string,
  companies: CompanyGroup[],
  captureFailures: boolean
): Promise<{ metrics: EvalMetrics; failures: FailureExample[] }> {
  let ndcgTotal = 0
  let mrrTotal = 0
  let precisionTotal = 0
  let top1Total = 0
  const failures: FailureExample[] = []

  for (const company of companies) {
    const documents = company.leads.map(formatLeadText)
    if (documents.length === 0) continue

    const rerankResult = await rerank({
      model: cohere.reranking(rerankModelId),
      query,
      documents,
    })

    const sorted = [...rerankResult.ranking].sort(
      (a, b) => (b.score ?? 0) - (a.score ?? 0)
    )

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

    const bestLead = company.leads.find((lead) => lead.rank === 1)
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

    if (captureFailures && bestLead && predicted[0] && top1 === 0 && failures.length < 8) {
      failures.push({
        company: company.company,
        expectedTop: bestLead,
        predictedTop: predicted[0],
      })
    }

    ndcgTotal += ndcg
    mrrTotal += mrr
    precisionTotal += precision
    top1Total += top1

  }

  const count = companies.length
  const metrics: EvalMetrics = {
    ndcg: count > 0 ? ndcgTotal / count : 0,
    mrr: count > 0 ? mrrTotal / count : 0,
    precision: count > 0 ? precisionTotal / count : 0,
    top1: count > 0 ? top1Total / count : 0,
  }

  return { metrics, failures }
}

async function evaluatePrompt(
  promptTemplate: string,
  trainCompanies: CompanyGroup[],
  testCompanies: CompanyGroup[]
): Promise<PromptEvaluation> {
  const query = await buildQuery(promptTemplate)

  const trainEval = await evaluateOnCompanies(query, trainCompanies, true)
  const testEval = await evaluateOnCompanies(query, testCompanies, false)
  const errorSummary = summarizeFailures(trainEval.failures)

  return {
    prompt: promptTemplate,
    query,
    trainMetrics: trainEval.metrics,
    testMetrics: testEval.metrics,
    failures: trainEval.failures,
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
    "You are optimizing a prompt template used to rewrite a persona spec into a concise query.",
    `The objective is to maximize ${objective.toUpperCase()} on a lead-ranking evaluation set.`,
    `Return JSON only: {\"prompts\": [\"...\"]}.`,
    `Each prompt must include the placeholder ${PERSONA_SPEC_PLACEHOLDER}.`,
    "Each prompt must instruct the model to output only the rewritten query text, no bullets or extra commentary.",
    "Avoid Markdown or code fences. Keep prompts under 1200 characters.",
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

  const result = await generateText({
    model: optimizerModel as any,
    prompt,
  })

  const text = result.text.trim()
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    console.warn("Optimizer did not return JSON. Skipping this round.")
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
    return []
  }
}

function isTemplatePrompt(promptTemplate: string) {
  return (
    promptTemplate !== DIRECT_PROMPT &&
    promptTemplate.includes(PERSONA_SPEC_PLACEHOLDER)
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
const { train: trainCompanies, test: testCompanies } = splitCompanies(companies)

const totalDocuments = companies.reduce(
  (sum, company) => sum + company.leads.length,
  0
)

const estimatedPromptEvaluations =
  2 + Math.max(0, rounds - 1) * (candidatesPerRound + mutationsPerRound)

const cohereCostPerSearch = Number.parseFloat(
  process.env.COHERE_RERANK_COST_PER_SEARCH ??
    process.env.RERANK_COST_PER_SEARCH ??
    ""
)
const cohereCostPer1kSearches = Number.parseFloat(
  process.env.COHERE_RERANK_COST_PER_1K_SEARCHES ??
    process.env.RERANK_COST_PER_1K_SEARCHES ??
    ""
)
const cohereCostPer1kDocs = Number.parseFloat(
  process.env.COHERE_RERANK_COST_PER_1K_DOCS ??
    process.env.RERANK_COST_PER_1K_DOCS ??
    ""
)

let rerankCostPerPrompt = 0
if (Number.isFinite(cohereCostPerSearch)) {
  rerankCostPerPrompt = companies.length * cohereCostPerSearch
} else if (Number.isFinite(cohereCostPer1kSearches)) {
  rerankCostPerPrompt = (companies.length / 1000) * cohereCostPer1kSearches
} else if (Number.isFinite(cohereCostPer1kDocs)) {
  rerankCostPerPrompt = (totalDocuments / 1000) * cohereCostPer1kDocs
}

const queryCalls = Math.max(0, estimatedPromptEvaluations - 1)
const optimizerCalls = Math.max(0, rounds - 1)

const defaultQueryPrompt = renderPersonaQueryPrompt(
  DEFAULT_PERSONA_QUERY_PROMPT,
  personaSpec
)
const estimatedQueryInputTokens =
  queryInputTokensOverride ?? estimateTokens(defaultQueryPrompt)
const estimatedQueryOutputTokens = queryOutputTokensOverride ?? 120
const estimatedOptimizerInputTokens =
  optimizerInputTokensOverride ?? 900
const estimatedOptimizerOutputTokens =
  optimizerOutputTokensOverride ?? 240

const openrouterInputRate = Number.parseFloat(
  process.env.OPENROUTER_COST_PER_1K_INPUT ??
    process.env.AI_COST_PER_1K_INPUT ??
    ""
)
const openrouterOutputRate = Number.parseFloat(
  process.env.OPENROUTER_COST_PER_1K_OUTPUT ??
    process.env.AI_COST_PER_1K_OUTPUT ??
    ""
)
const openrouterTotalRate = Number.parseFloat(
  process.env.OPENROUTER_COST_PER_1K_TOKENS ??
    process.env.AI_COST_PER_1K_TOKENS ??
    ""
)

let openrouterQueryCost = 0
let openrouterOptimizerCost = 0
if (Number.isFinite(openrouterInputRate) || Number.isFinite(openrouterOutputRate)) {
  openrouterQueryCost =
    (estimatedQueryInputTokens / 1000) * (openrouterInputRate || 0) +
    (estimatedQueryOutputTokens / 1000) * (openrouterOutputRate || 0)
  openrouterOptimizerCost =
    (estimatedOptimizerInputTokens / 1000) * (openrouterInputRate || 0) +
    (estimatedOptimizerOutputTokens / 1000) * (openrouterOutputRate || 0)
} else if (Number.isFinite(openrouterTotalRate)) {
  openrouterQueryCost =
    ((estimatedQueryInputTokens + estimatedQueryOutputTokens) / 1000) *
    openrouterTotalRate
  openrouterOptimizerCost =
    ((estimatedOptimizerInputTokens + estimatedOptimizerOutputTokens) / 1000) *
    openrouterTotalRate
}

const estimatedRerankCost = rerankCostPerPrompt * estimatedPromptEvaluations
const estimatedOpenrouterCost =
  openrouterQueryCost * queryCalls + openrouterOptimizerCost * optimizerCalls
const estimatedTotalCost = estimatedRerankCost + estimatedOpenrouterCost

console.log(
  `Loaded ${allCompanies.length} companies (evaluating ${companies.length}).`
)
console.log(
  `Query model: ${queryModelId} | Optimizer model: ${optimizerModelId} | Rerank model: ${rerankModelId}`
)
console.log(
  `Train/test split: ${trainCompanies.length}/${testCompanies.length} (ratio ${Number.isFinite(trainRatioInput) ? trainRatioInput : 0.8})`
)
console.log(
  `Estimated evaluations: ${estimatedPromptEvaluations} prompts | ${companies.length} companies | ${totalDocuments} total documents`
)

if (rerankCostPerPrompt > 0 || openrouterQueryCost > 0 || openrouterOptimizerCost > 0) {
  console.log(
    `Estimated costs: rerank $${estimatedRerankCost.toFixed(2)} + OpenRouter $${estimatedOpenrouterCost.toFixed(2)} = $${estimatedTotalCost.toFixed(2)}`
  )
} else {
  console.log(
    "Estimated costs: set COHERE_RERANK_COST_PER_SEARCH / COHERE_RERANK_COST_PER_1K_DOCS and OPENROUTER_COST_PER_1K_* to estimate."
  )
}

if (Number.isFinite(budgetUsd) && budgetUsd > 0 && estimatedTotalCost > budgetUsd && !forceRun) {
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

if (!process.env.COHERE_API_KEY) {
  console.error("Missing COHERE_API_KEY for reranking.")
  process.exit(1)
}

if (!process.env.OPENROUTER_API_KEY) {
  console.error("Missing OPENROUTER_API_KEY for prompt optimization.")
  process.exit(1)
}

queryModel = getOpenRouterModel(queryModelId)
optimizerModel = getOpenRouterModel(optimizerModelId)

if (!queryModel) {
  console.error("Unable to create OpenRouter model for query generation.")
  process.exit(1)
}

if (!optimizerModel) {
  console.error("Unable to create OpenRouter model for prompt optimization.")
  process.exit(1)
}

const evaluations = new Map<string, PromptEvaluation>()

async function getEvaluation(promptTemplate: string) {
  const cached = evaluations.get(promptTemplate)
  if (cached) return cached

  console.log("\nEvaluating prompt:")
  console.log(promptTemplate)

  const evaluation = await evaluatePrompt(
    promptTemplate,
    trainCompanies,
    testCompanies
  )
  evaluations.set(promptTemplate, evaluation)

  console.log(
    `Train metrics: ${formatMetrics(evaluation.trainMetrics)} | Test metrics: ${formatMetrics(evaluation.testMetrics)}`
  )
  return evaluation
}

const baselinePrompts = [DEFAULT_PERSONA_QUERY_PROMPT, DIRECT_PROMPT]

for (const promptTemplate of baselinePrompts) {
  await getEvaluation(promptTemplate)
}

let population = [DEFAULT_PERSONA_QUERY_PROMPT]

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
console.log("Generated query:")
console.log(best.query)

const directBaseline = evaluations.get(DIRECT_PROMPT)
if (directBaseline) {
  console.log("\nDirect persona baseline:")
  console.log(
    `Train metrics: ${formatMetrics(directBaseline.trainMetrics)} | Test metrics: ${formatMetrics(directBaseline.testMetrics)}`
  )
  console.log("Generated query:")
  console.log(directBaseline.query)
}

if (outputPath) {
  fs.writeFileSync(outputPath, best.prompt)
  console.log(`\nSaved best prompt to ${outputPath}`)
}

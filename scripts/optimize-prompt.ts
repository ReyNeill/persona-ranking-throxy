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
  expectedTop: string
  predictedTop: string
}

type PromptEvaluation = {
  prompt: string
  query: string
  metrics: EvalMetrics
  failures: FailureExample[]
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
const seed = getArgNumber("--seed", Date.now()) ?? Date.now()
const outputPath = getArgValue("--output")
const objective =
  (getArgValue("--objective") ?? "ndcg").toLowerCase() ?? "ndcg"

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

if (!process.env.COHERE_API_KEY) {
  console.error("Missing COHERE_API_KEY for reranking.")
  process.exit(1)
}

if (!process.env.OPENROUTER_API_KEY) {
  console.error("Missing OPENROUTER_API_KEY for prompt optimization.")
  process.exit(1)
}

const queryModel = getOpenRouterModel(queryModelId)
const optimizerModel = getOpenRouterModel(optimizerModelId)

if (!queryModel) {
  console.error("Unable to create OpenRouter model for query generation.")
  process.exit(1)
}

if (!optimizerModel) {
  console.error("Unable to create OpenRouter model for prompt optimization.")
  process.exit(1)
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

async function evaluatePrompt(
  promptTemplate: string,
  companies: CompanyGroup[]
): Promise<PromptEvaluation> {
  const query = await buildQuery(promptTemplate)

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

    if (bestLead && predicted[0] && top1 === 0 && failures.length < 8) {
      failures.push({
        company: company.company,
        expectedTop: renderLeadLabel(bestLead),
        predictedTop: renderLeadLabel(predicted[0]),
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

  return { prompt: promptTemplate, query, metrics, failures }
}

function formatPromptSummary(evaluation: PromptEvaluation, index: number) {
  const score = scoreObjective(evaluation.metrics)
  const metrics = evaluation.metrics
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
  const failureBlock = failures.length
    ? [
        "Failure examples from the current best prompt:",
        ...failures.map(
          (failure) =>
            `- ${failure.company}: expected ${failure.expectedTop} but got ${failure.predictedTop}`
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

  if (failureBlock) {
    promptParts.push("", failureBlock)
  }

  const prompt = promptParts.join("\n")

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
    return prompts.map((value) => value.trim()).filter(Boolean)
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

console.log(
  `Loaded ${allCompanies.length} companies (evaluating ${companies.length}).`
)
console.log(
  `Query model: ${queryModelId} | Optimizer model: ${optimizerModelId} | Rerank model: ${rerankModelId}`
)

const evaluations = new Map<string, PromptEvaluation>()

async function getEvaluation(promptTemplate: string) {
  const cached = evaluations.get(promptTemplate)
  if (cached) return cached

  console.log("\nEvaluating prompt:")
  console.log(promptTemplate)

  const evaluation = await evaluatePrompt(promptTemplate, companies)
  evaluations.set(promptTemplate, evaluation)

  console.log(`Metrics: ${formatMetrics(evaluation.metrics)}`)
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
    .sort((a, b) => scoreObjective(b.metrics) - scoreObjective(a.metrics))

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
  const filtered = candidatePrompts.filter(isPromptValid)
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
  .sort((a, b) => scoreObjective(b.metrics) - scoreObjective(a.metrics))

const best = finalScored[0]
if (!best) {
  console.error("No prompts evaluated successfully.")
  process.exit(1)
}

console.log("\nBest prompt template:")
console.log(best.prompt)
console.log(`Best metrics: ${formatMetrics(best.metrics)}`)
console.log("Generated query:")
console.log(best.query)

const directBaseline = evaluations.get(DIRECT_PROMPT)
if (directBaseline) {
  console.log("\nDirect persona baseline:")
  console.log(`Metrics: ${formatMetrics(directBaseline.metrics)}`)
  console.log("Generated query:")
  console.log(directBaseline.query)
}

if (outputPath) {
  fs.writeFileSync(outputPath, best.prompt)
  console.log(`\nSaved best prompt to ${outputPath}`)
}

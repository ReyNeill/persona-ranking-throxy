import { NextResponse } from "next/server"

import { createSupabaseServerClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

type AiCallRow = {
  provider: string
  cost_usd: number | string | null
  input_tokens: number | null
  output_tokens: number | null
  documents_count: number | null
  run_id: string | null
}

type StatsSummary = {
  callCount: number
  totalCost: number | null
  avgCost: number | null
  inputTokens: number
  outputTokens: number
  documents: number
}

function parseCost(value: AiCallRow["cost_usd"]) {
  if (value === null || value === undefined) return null
  const parsed = typeof value === "string" ? Number(value) : value
  return Number.isFinite(parsed) ? parsed : null
}

function summarize(rows: AiCallRow[]): StatsSummary {
  let costTotal = 0
  let costCount = 0
  let inputTokens = 0
  let outputTokens = 0
  let documents = 0

  for (const row of rows) {
    const cost = parseCost(row.cost_usd)
    if (cost !== null) {
      costTotal += cost
      costCount += 1
    }

    if (row.input_tokens) inputTokens += row.input_tokens
    if (row.output_tokens) outputTokens += row.output_tokens
    if (row.documents_count) documents += row.documents_count
  }

  return {
    callCount: rows.length,
    totalCost: costCount > 0 ? costTotal : null,
    avgCost: costCount > 0 ? costTotal / costCount : null,
    inputTokens,
    outputTokens,
    documents,
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const runId = searchParams.get("runId")
  const supabase = createSupabaseServerClient()

  const { data, error } = await supabase
    .from("ai_calls")
    .select("provider, cost_usd, input_tokens, output_tokens, documents_count, run_id")

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as AiCallRow[]
  const totals = summarize(rows)

  const providerMap = new Map<string, AiCallRow[]>()
  for (const row of rows) {
    const list = providerMap.get(row.provider) ?? []
    list.push(row)
    providerMap.set(row.provider, list)
  }

  const byProvider = Array.from(providerMap.entries()).map(
    ([provider, entries]) => ({
      provider,
      ...summarize(entries),
    })
  )

  const runStats = runId
    ? summarize(rows.filter((row) => row.run_id === runId))
    : null

  return NextResponse.json({ totals, byProvider, run: runStats })
}

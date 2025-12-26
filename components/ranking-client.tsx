"use client"

import * as React from "react"

import { RankingTable } from "@/components/ranking-table"
import type { RankingResponse } from "@/components/ranking-types"

const DEFAULT_PERSONA_SPEC = `We sell a sales engagement platform.
Target: revenue leaders (VP Sales, Head of Sales, Sales Ops, RevOps).
Avoid: HR, Recruiting, IT, Finance, Legal, or non-revenue roles.
Prefer mid-market to enterprise companies and decision-makers.`

export function RankingClient() {
  const [personaSpec, setPersonaSpec] = React.useState(DEFAULT_PERSONA_SPEC)
  const [topN, setTopN] = React.useState(3)
  const [minScore, setMinScore] = React.useState(0.4)
  const [results, setResults] = React.useState<RankingResponse | null>(null)
  const [isRunning, setIsRunning] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let isMounted = true
    fetch("/api/results")
      .then((res) => res.json())
      .then((data: RankingResponse) => {
        if (isMounted) setResults(data)
      })
      .catch(() => null)

    return () => {
      isMounted = false
    }
  }, [])

  async function runRanking() {
    setIsRunning(true)
    setError(null)

    try {
      const response = await fetch("/api/rank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personaSpec,
          topN,
          minScore,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to run ranking")
      }

      setResults(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-12">
      <section className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm uppercase tracking-[0.3em]">
          Persona Ranking System
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Rank leads per company with AI
        </h1>
        <p className="text-muted-foreground text-base">
          Provide the persona spec, run ranking, and surface only the most
          relevant contacts.
        </p>
      </section>

      <section className="grid gap-6 rounded-2xl border border-dashed p-6">
        <div className="grid gap-3">
          <label className="text-sm font-medium">Persona spec</label>
          <textarea
            value={personaSpec}
            onChange={(event) => setPersonaSpec(event.target.value)}
            className="min-h-[160px] w-full resize-y rounded-xl border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <label className="flex flex-col gap-2 text-sm font-medium">
            Top N per company
            <input
              type="number"
              min={1}
              max={25}
              value={topN}
              onChange={(event) => setTopN(Number(event.target.value))}
              className="rounded-xl border px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium">
            Relevance threshold (0-1)
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={minScore}
              onChange={(event) => setMinScore(Number(event.target.value))}
              className="rounded-xl border px-3 py-2 text-sm"
            />
          </label>
          <div className="flex items-end">
            <button
              onClick={runRanking}
              disabled={isRunning}
              className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {isRunning ? "Ranking..." : "Run ranking"}
            </button>
          </div>
        </div>

        {error ? <p className="text-sm text-red-500">{error}</p> : null}
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold">Results</h2>
          {results?.runId ? (
            <p className="text-muted-foreground text-xs">
              Run ID: {results.runId}
            </p>
          ) : null}
        </div>

        {!results?.companies?.length ? (
          <div className="text-muted-foreground rounded-2xl border border-dashed p-6 text-sm">
            No rankings yet. Load a CSV and run the ranking to see results.
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {results.companies.map((company) => (
              <div
                key={company.companyId}
                className="rounded-2xl border p-5"
              >
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg font-semibold">{company.companyName}</h3>
                  <span className="text-muted-foreground text-xs">
                    {company.leads.filter((lead) => lead.selected).length} selected
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <RankingTable leads={company.leads} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

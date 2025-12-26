"use client"

import * as React from "react"

import { RankingTable } from "@/components/ranking-table"
import type { RankingResponse } from "@/components/ranking-types"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

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

      <Card>
        <CardHeader>
          <CardTitle>Ranking Controls</CardTitle>
          <CardDescription>
            Configure the persona and pick how many leads per company to keep.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-2">
            <Label htmlFor="persona-spec">Persona spec</Label>
            <Textarea
              id="persona-spec"
              value={personaSpec}
              onChange={(event) => setPersonaSpec(event.target.value)}
              className="min-h-[160px] resize-y"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="top-n">Top N per company</Label>
              <Input
                id="top-n"
                type="number"
                min={1}
                max={25}
                value={topN}
                onChange={(event) => setTopN(Number(event.target.value))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="min-score">Relevance threshold (0-1)</Label>
              <Input
                id="min-score"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={minScore}
                onChange={(event) => setMinScore(Number(event.target.value))}
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={runRanking}
                disabled={isRunning}
                className="w-full"
              >
                {isRunning ? "Ranking..." : "Run ranking"}
              </Button>
            </div>
          </div>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </CardContent>
      </Card>

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
          <Card>
            <CardContent className="text-muted-foreground py-6 text-sm">
              No rankings yet. Load a CSV and run the ranking to see results.
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-6">
            {results.companies.map((company) => (
              <Card key={company.companyId}>
                <CardHeader className="flex flex-row items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-lg">
                      {company.companyName}
                    </CardTitle>
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {company.leads.filter((lead) => lead.selected).length} selected
                  </span>
                </CardHeader>
                <CardContent>
                  <RankingTable leads={company.leads} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

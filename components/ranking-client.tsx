"use client"

import * as React from "react"

import { RankingTable } from "@/components/ranking-table"
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler"
import type {
  RankingResponse,
  StatsResponse,
} from "@/components/ranking-types"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"

const DEFAULT_PERSONA_SPEC = `We sell a sales engagement platform.
Target: revenue leaders (VP Sales, Head of Sales, Sales Ops, RevOps).
Avoid: HR, Recruiting, IT, Finance, Legal, or non-revenue roles.
Prefer mid-market to enterprise companies and decision-makers.`

export function RankingClient() {
  const [personaSpec, setPersonaSpec] = React.useState(DEFAULT_PERSONA_SPEC)
  const [topN, setTopN] = React.useState(3)
  const [minScore, setMinScore] = React.useState(0.4)
  const [results, setResults] = React.useState<RankingResponse | null>(null)
  const [stats, setStats] = React.useState<StatsResponse | null>(null)
  const [csvFile, setCsvFile] = React.useState<File | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [isRunning, setIsRunning] = React.useState(false)
  const [isUploading, setIsUploading] = React.useState(false)
  const [isLoadingResults, setIsLoadingResults] = React.useState(true)
  const [isLoadingStats, setIsLoadingStats] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let isMounted = true
    setIsLoadingResults(true)
    fetch("/api/results")
      .then((res) => res.json())
      .then((data: RankingResponse) => {
        if (isMounted) setResults(data)
      })
      .catch(() => null)
      .finally(() => {
        if (isMounted) setIsLoadingResults(false)
      })

    return () => {
      isMounted = false
    }
  }, [])

  React.useEffect(() => {
    let isMounted = true

    const params = results?.runId ? `?runId=${results.runId}` : ""
    setIsLoadingStats(true)
    fetch(`/api/stats${params}`)
      .then((res) => res.json())
      .then((data: StatsResponse) => {
        if (isMounted && data?.totals) {
          setStats(data)
        }
      })
      .catch(() => null)
      .finally(() => {
        if (isMounted) setIsLoadingStats(false)
      })

    return () => {
      isMounted = false
    }
  }, [results?.runId])

  function formatCredits(value: number | null) {
    if (value === null || Number.isNaN(value)) return "—"
    return `${value.toFixed(4)} credits`
  }

  function formatNumber(value: number) {
    return new Intl.NumberFormat("en-US").format(value)
  }

  function escapeCsv(value: string) {
    if (value.includes('"') || value.includes(",") || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`
    }
    return value
  }

  function exportSelectedToCsv() {
    if (!results?.companies?.length) return

    const rows: string[] = []
    rows.push(
      [
        "company",
        "lead_name",
        "title",
        "email",
        "linkedin",
        "score",
        "rank",
        "reason",
      ].join(",")
    )

    for (const company of results.companies) {
      const topLeads = company.leads.filter(
        (lead) => lead.rank !== null && lead.rank <= exportTopN
      )
      for (const lead of topLeads) {
        rows.push(
          [
            company.companyName ?? "",
            lead.fullName ?? "",
            lead.title ?? "",
            lead.email ?? "",
            lead.linkedinUrl ?? "",
            lead.score !== null ? lead.score.toFixed(2) : "",
            lead.rank !== null ? String(lead.rank) : "",
            lead.reason ?? "",
          ]
            .map((value) => escapeCsv(String(value)))
            .join(",")
        )
      }
    }

    if (rows.length <= 1) return

    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "persona-ranking-top-leads.csv"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const exportTopN = results?.topN ?? topN
  const exportableCount =
    results?.companies?.reduce((count, company) => {
      const companyCount = company.leads.filter(
        (lead) => lead.rank !== null && lead.rank <= exportTopN
      ).length
      return count + companyCount
    }, 0) ?? 0

  async function runRanking() {
    setIsRunning(true)
    setIsLoadingResults(true)
    setStats(null)
    setError(null)

    try {
      let ingestionId: string | null = null

      if (csvFile) {
        setIsUploading(true)
        const formData = new FormData()
        formData.append("file", csvFile)

        const ingestResponse = await fetch("/api/ingest", {
          method: "POST",
          body: formData,
        })
        const ingestData = await ingestResponse.json()
        if (!ingestResponse.ok) {
          throw new Error(ingestData.error ?? "Failed to ingest CSV")
        }

        ingestionId = ingestData.ingestionId
        toast.success("Leads uploaded", {
          description: `Loaded ${ingestData.leadCount} leads from ${csvFile.name} (${ingestData.companyCount} companies, ${ingestData.skippedCount} skipped).`,
        })
        setCsvFile(null)
      }

      const response = await fetch("/api/rank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personaSpec,
          topN,
          minScore,
          ingestionId,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to run ranking")
      }

      setResults(data)
      toast.success("Ranking complete", {
        description: "Results updated with the latest ranking run.",
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      setError(message)
      toast.error("Ranking failed", {
        description: message,
      })
    } finally {
      setIsRunning(false)
      setIsLoadingResults(false)
      setIsUploading(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-12">
      <section className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-primary/70 text-sm uppercase tracking-[0.3em]">
              Persona Ranking System
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              Rank leads per company with AI
            </h1>
            <p className="text-muted-foreground text-base">
              Provide the persona spec, run ranking, and surface only the most
              relevant contacts.
            </p>
          </div>
          <AnimatedThemeToggler className="border-border bg-background text-foreground hover:bg-muted flex size-9 items-center justify-center rounded-full border" />
        </div>
      </section>

      <Card className="ring-primary/10">
        <CardHeader>
          <CardTitle>Ranking Controls</CardTitle>
          <CardDescription>
            Configure the persona and pick how many leads per company to keep.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-2 text-center md:col-start-2">
              <Label htmlFor="csv-upload" className="w-full text-center">
                Upload new leads (CSV)
              </Label>
              <input
                ref={fileInputRef}
                id="csv-upload"
                type="file"
                accept=".csv"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null
                  setCsvFile(file)
                }}
              />
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {csvFile ? "Change CSV" : "Choose CSV"}
                </Button>
              </div>
              {csvFile ? (
                <p className="text-muted-foreground text-xs">
                  Selected: {csvFile.name}
                </p>
              ) : null}
              <p className="text-muted-foreground text-xs">
                Upload a CSV to ingest and rank new leads immediately.
              </p>
            </div>
          </div>
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
                disabled={isRunning || isUploading}
                className="w-full"
              >
                {isUploading
                  ? "Uploading..."
                  : isRunning
                    ? "Ranking..."
                    : "Run ranking"}
              </Button>
            </div>
          </div>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </CardContent>
      </Card>

      {isLoadingStats ? (
        <section className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Card key={`stats-skeleton-${index}`} className="ring-primary/10">
              <CardHeader className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-6 w-20" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-3 w-28" />
              </CardContent>
            </Card>
          ))}
        </section>
      ) : stats ? (
        <section className="grid gap-4 md:grid-cols-4">
          <Card className="ring-primary/10">
            <CardHeader className="space-y-1">
              <CardDescription>Total cost (credits)</CardDescription>
              <CardTitle className="text-xl">
                {formatCredits(stats.totals.totalCost)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-xs">
              {formatNumber(stats.totals.callCount)} calls
            </CardContent>
          </Card>
          <Card className="ring-primary/10">
            <CardHeader className="space-y-1">
              <CardDescription>Avg cost / call (credits)</CardDescription>
              <CardTitle className="text-xl">
                {formatCredits(stats.totals.avgCost)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-xs">
              {formatNumber(stats.totals.inputTokens)} input tokens
            </CardContent>
          </Card>
          <Card className="ring-primary/10">
            <CardHeader className="space-y-1">
              <CardDescription>Output tokens</CardDescription>
              <CardTitle className="text-xl">
                {formatNumber(stats.totals.outputTokens)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-xs">
              {formatNumber(stats.totals.documents)} documents reranked
            </CardContent>
          </Card>
          <Card className="ring-primary/10">
            <CardHeader className="space-y-1">
              <CardDescription>Last run cost (credits)</CardDescription>
              <CardTitle className="text-xl">
                {formatCredits(stats.run?.totalCost ?? null)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-xs">
              {formatNumber(stats.run?.callCount ?? 0)} calls
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">Results</h2>
          <div className="flex flex-wrap items-center gap-3">
            {results?.runId ? (
              <p className="text-muted-foreground text-xs">
                Run ID: {results.runId}
              </p>
            ) : null}
            <Button
              variant="default"
              size="sm"
              onClick={exportSelectedToCsv}
              disabled={exportableCount === 0}
            >
              Export top leads CSV
            </Button>
          </div>
        </div>

        {isLoadingResults ? (
          <div className="flex flex-col gap-6">
            {Array.from({ length: 2 }).map((_, index) => (
              <Card key={`results-skeleton-${index}`} className="ring-primary/10">
                <CardHeader className="space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </CardHeader>
                <CardContent className="space-y-3">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : !results?.companies?.length ? (
          <Card>
            <CardContent className="text-muted-foreground py-6 text-sm">
              No rankings yet. Load a CSV and run the ranking to see results.
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-6">
            {results.companies.map((company) => (
              <Card key={company.companyId} className="ring-primary/10">
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

"use client"

import * as React from "react"
import Image from "next/image"

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from "sonner"
import { CircleHelp } from "lucide-react"

const DEFAULT_PERSONA_SPECS = [
  `We sell a sales engagement platform.
Target: revenue leaders (VP Sales, Head of Sales, Sales Ops, RevOps).
Avoid: HR, Recruiting, IT, Finance, Legal, or non-revenue roles.
Prefer mid-market to enterprise companies and decision-makers.`,
  `We help B2B marketing teams accelerate pipeline.
Target: demand gen, growth, and marketing ops leaders.
Avoid: student roles, recruiters, and customer support.
Prefer SaaS companies with 50–500 employees.`,
  `We provide outbound infrastructure for healthcare companies.
Target: VP Sales, Head of Growth, or Revenue Operations.
Avoid: clinicians, nurses, and non-commercial roles.
Prefer healthcare software or services companies.`,
  `We support manufacturing firms with AI-driven prospecting.
Target: sales leadership and business development heads.
Avoid: IT support, finance, and HR.
Prefer mid-market to enterprise manufacturers.`,
]

function pickRandomPersonaSpec() {
  const index = Math.floor(Math.random() * DEFAULT_PERSONA_SPECS.length)
  return DEFAULT_PERSONA_SPECS[index]
}

type ProgressStatus = "idle" | "running" | "completed" | "error"

type RankingStreamEvent =
  | { type: "start"; runId: string; totalCompanies: number }
  | { type: "persona_ready"; runId: string }
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
      company: RankingResponse["companies"][number]
      completed: number
      total: number
    }
  | { type: "complete"; runId: string; completed: number; total: number }
  | { type: "error"; message: string }

type PromptLeaderboardEntry = {
  prompt: string
  score: number
  trainMetrics: {
    ndcg: number
    mrr: number
    precision: number
    top1: number
  }
  testMetrics: {
    ndcg: number
    mrr: number
    precision: number
    top1: number
  }
  query: string
  errorSummary: string
}

type PromptLeaderboard = {
  objective: string | null
  k: number | null
  updatedAt: string | null
  queryModelId?: string | null
  optimizerModelId?: string | null
  rerankModelId?: string | null
  evalPath?: string | null
  personaPath?: string | null
  entries: PromptLeaderboardEntry[]
}

export function RankingClient() {
  const [personaSpec, setPersonaSpec] = React.useState(
    () => pickRandomPersonaSpec()
  )
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
  const [statsVersion, setStatsVersion] = React.useState(0)
  const [companyPagination, setCompanyPagination] = React.useState({
    pageIndex: 0,
    pageSize: 4,
  })
  const [selectedCompany, setSelectedCompany] = React.useState<
    RankingResponse["companies"][number] | null
  >(null)
  const [isCompanyDialogOpen, setIsCompanyDialogOpen] = React.useState(false)
  const [isPromptDialogOpen, setIsPromptDialogOpen] = React.useState(false)
  const [isPromptLoading, setIsPromptLoading] = React.useState(false)
  const [promptError, setPromptError] = React.useState<string | null>(null)
  const [activePrompt, setActivePrompt] = React.useState<string | null>(null)
  const [isLeaderboardDialogOpen, setIsLeaderboardDialogOpen] =
    React.useState(false)
  const [isLeaderboardLoading, setIsLeaderboardLoading] = React.useState(false)
  const [leaderboardError, setLeaderboardError] = React.useState<string | null>(
    null
  )
  const [leaderboard, setLeaderboard] =
    React.useState<PromptLeaderboard | null>(null)
  const [isLeaderboardPromptOpen, setIsLeaderboardPromptOpen] =
    React.useState(false)
  const [selectedLeaderboardPrompt, setSelectedLeaderboardPrompt] =
    React.useState<PromptLeaderboardEntry | null>(null)
  const [progress, setProgress] = React.useState<{
    status: ProgressStatus
    percent: number
    total: number
    completed: number
    message: string
  }>({
    status: "idle",
    percent: 0,
    total: 0,
    completed: 0,
    message: "",
  })

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
  }, [results?.runId, statsVersion])

  React.useEffect(() => {
    if (!isPromptDialogOpen) return
    let isMounted = true
    setIsPromptLoading(true)
    setPromptError(null)
    fetch("/api/prompts/active")
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data?.error ?? "Failed to load prompt.")
        }
        return data as { prompt?: string | null }
      })
      .then((data) => {
        if (!isMounted) return
        setActivePrompt(data.prompt ?? null)
      })
      .catch((err) => {
        if (!isMounted) return
        setPromptError(err instanceof Error ? err.message : "Failed to load.")
      })
      .finally(() => {
        if (!isMounted) return
        setIsPromptLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [isPromptDialogOpen])

  React.useEffect(() => {
    if (!isLeaderboardDialogOpen) return
    let isMounted = true
    setIsLeaderboardLoading(true)
    setLeaderboardError(null)
    fetch("/api/prompts/leaderboard")
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data?.error ?? "Failed to load leaderboard.")
        }
        return data as PromptLeaderboard
      })
      .then((data) => {
        if (!isMounted) return
        setLeaderboard(data)
      })
      .catch((err) => {
        if (!isMounted) return
        setLeaderboardError(
          err instanceof Error ? err.message : "Failed to load."
        )
      })
      .finally(() => {
        if (!isMounted) return
        setIsLeaderboardLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [isLeaderboardDialogOpen])

  React.useEffect(() => {
    setCompanyPagination((prev) => ({ ...prev, pageIndex: 0 }))
  }, [results?.runId])

  React.useEffect(() => {
    if (!selectedCompany?.companyId) return
    const updated = results?.companies?.find(
      (company) => company.companyId === selectedCompany.companyId
    )
    if (updated && updated !== selectedCompany) {
      setSelectedCompany(updated)
    }
  }, [results?.companies, selectedCompany?.companyId])

  function formatCredits(value: number | null) {
    if (value === null || Number.isNaN(value)) return "—"
    return `${value.toFixed(4)} credits`
  }

  function formatNumber(value: number) {
    return new Intl.NumberFormat("en-US").format(value)
  }

  function formatMetric(value: number | null | undefined) {
    if (value === null || value === undefined || Number.isNaN(value)) return "—"
    return value.toFixed(3)
  }

  function formatDateTime(value: string | null | undefined) {
    if (!value) return "—"
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return "—"
    return parsed.toLocaleString("en-US")
  }

  const leaderboardEntries = React.useMemo(() => {
    const entries = leaderboard?.entries ?? []
    return [...entries].sort((a, b) => {
      const aScore = Number.isFinite(a.score) ? a.score : -Infinity
      const bScore = Number.isFinite(b.score) ? b.score : -Infinity
      if (aScore !== bScore) return bScore - aScore
      return (a.prompt ?? "").localeCompare(b.prompt ?? "")
    })
  }, [leaderboard?.entries])

  function escapeCsv(value: string) {
    if (value.includes('"') || value.includes(",") || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`
    }
    return value
  }

  function exportSelectedToCsv() {
    if (!results?.companies?.length) return

    const exportRows: Array<{
      companyName: string
      lead: RankingResponse["companies"][number]["leads"][number]
    }> = []
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
        exportRows.push({
          companyName: company.companyName ?? "",
          lead,
        })
      }
    }

    exportRows.sort((a, b) => {
      const scoreDelta = (b.lead.score ?? -1) - (a.lead.score ?? -1)
      if (scoreDelta !== 0) return scoreDelta
      const companySort = a.companyName.localeCompare(b.companyName)
      if (companySort !== 0) return companySort
      return (a.lead.fullName ?? "").localeCompare(b.lead.fullName ?? "")
    })

    for (const row of exportRows) {
      const lead = row.lead
      rows.push(
        [
          row.companyName,
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

  const companies = React.useMemo(() => {
    const list = results?.companies ?? []
    return [...list].sort((a, b) => {
      const aSelected = a.leads.filter((lead) => lead.selected).length
      const bSelected = b.leads.filter((lead) => lead.selected).length
      if (aSelected !== bSelected) return bSelected - aSelected
      const aTopScore = Math.max(
        ...a.leads.map((lead) => lead.score ?? -1),
        -1
      )
      const bTopScore = Math.max(
        ...b.leads.map((lead) => lead.score ?? -1),
        -1
      )
      if (aTopScore !== bTopScore) return bTopScore - aTopScore
      const nameSort = a.companyName.localeCompare(b.companyName)
      if (nameSort !== 0) return nameSort
      return a.companyId.localeCompare(b.companyId)
    })
  }, [results?.companies])

  const companyPageCount = Math.max(
    1,
    Math.ceil(companies.length / companyPagination.pageSize)
  )
  const companyPageIndex = Math.min(
    companyPagination.pageIndex,
    companyPageCount - 1
  )
  const pagedCompanies = companies.slice(
    companyPageIndex * companyPagination.pageSize,
    (companyPageIndex + 1) * companyPagination.pageSize
  )

  React.useEffect(() => {
    if (companyPagination.pageIndex !== companyPageIndex) {
      setCompanyPagination((prev) => ({
        ...prev,
        pageIndex: companyPageIndex,
      }))
    }
  }, [companyPageIndex, companyPagination.pageIndex])

  const companyPageItems = React.useMemo(() => {
    if (companyPageCount <= 7) {
      return Array.from({ length: companyPageCount }, (_, index) => index)
    }

    const items: Array<number | "ellipsis"> = [0]
    const start = Math.max(1, companyPageIndex - 1)
    const end = Math.min(companyPageCount - 2, companyPageIndex + 1)

    if (start > 1) items.push("ellipsis")
    for (let i = start; i <= end; i += 1) items.push(i)
    if (end < companyPageCount - 2) items.push("ellipsis")
    items.push(companyPageCount - 1)

    return items
  }, [companyPageCount, companyPageIndex])

  async function runRanking() {
    setIsRunning(true)
    setIsLoadingResults(true)
    setStats(null)
    setError(null)
    setResults(null)
    setSelectedCompany(null)
    setIsCompanyDialogOpen(false)
    setProgress({
      status: "running",
      percent: 0,
      total: 0,
      completed: 0,
      message: "Preparing ranking...",
    })

    try {
      let ingestionId: string | null = null
      const trimmedSpec = personaSpec.trim()

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
        setIsUploading(false)
      }

      const response = await fetch("/api/rank/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personaSpec: trimmedSpec,
          topN,
          minScore,
          ingestionId,
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error ?? "Failed to run ranking")
      }

      if (!response.body) {
        throw new Error("Streaming response unavailable")
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      const handleEvent = (event: RankingStreamEvent) => {
        if (event.type === "start") {
          setResults({
            runId: event.runId,
            topN,
            minScore,
            personaSpec: trimmedSpec,
            companies: [],
          })
          setProgress((prev) => ({
            ...prev,
            status: "running",
            percent: 0,
            total: event.totalCompanies,
            completed: 0,
            message:
              event.totalCompanies > 0
                ? `Ranking ${event.totalCompanies} companies...`
                : "Preparing ranking...",
          }))
          return
        }

        if (event.type === "persona_ready") {
          setProgress((prev) => ({
            ...prev,
            message: "Persona query ready. Starting ranking...",
          }))
          return
        }

        if (event.type === "company_start") {
          setProgress((prev) => ({
            ...prev,
            message: `Ranking ${event.companyName} (${event.index}/${event.total})`,
          }))
          return
        }

        if (event.type === "company_result") {
          const percent =
            event.total > 0
              ? Math.round((event.completed / event.total) * 100)
              : 0
          setResults((prev) => {
            const existing = prev?.companies ?? []
            const filtered = existing.filter(
              (company) => company.companyId !== event.company.companyId
            )
            return {
              runId: prev?.runId ?? event.runId,
              topN: prev?.topN ?? topN,
              minScore: prev?.minScore ?? minScore,
              personaSpec: prev?.personaSpec ?? trimmedSpec,
              companies: [...filtered, event.company],
            }
          })
          setIsLoadingResults(false)
          setProgress((prev) => ({
            ...prev,
            percent,
            total: event.total,
            completed: event.completed,
            message: `Ranked ${event.company.companyName}`,
          }))
          return
        }

        if (event.type === "complete") {
          setProgress((prev) => ({
            ...prev,
            status: "completed",
            percent: 100,
            total: event.total,
            completed: event.completed,
            message: "Ranking complete.",
          }))
          setStatsVersion((version) => version + 1)
          toast.success("Ranking complete", {
            description: "Results updated with the latest ranking run.",
            style: {
              "--success-bg": "var(--ranking-toast-bg)",
              "--success-text": "var(--ranking-toast-text)",
              "--success-border": "var(--ranking-toast-border)",
            } as React.CSSProperties,
          })
          return
        }

        if (event.type === "error") {
          setProgress((prev) => ({
            ...prev,
            status: "error",
            message: event.message,
          }))
          setError(event.message)
          toast.error("Ranking failed", {
            description: event.message,
          })
        }
      }

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let boundaryIndex = buffer.indexOf("\n\n")
        while (boundaryIndex !== -1) {
          const chunk = buffer.slice(0, boundaryIndex)
          buffer = buffer.slice(boundaryIndex + 2)
          const dataLine = chunk
            .split("\n")
            .find((line) => line.startsWith("data: "))
          if (dataLine) {
            const json = dataLine.replace(/^data:\s*/, "")
            try {
              const event = JSON.parse(json) as RankingStreamEvent
              handleEvent(event)
            } catch {
              // Ignore malformed events.
            }
          }
          boundaryIndex = buffer.indexOf("\n\n")
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      setError(message)
      toast.error("Ranking failed", {
        description: message,
      })
      setProgress((prev) => ({
        ...prev,
        status: "error",
        message,
      }))
    } finally {
      setIsRunning(false)
      setIsUploading(false)
      setIsLoadingResults(false)
    }
  }

  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-12">
      <section className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="relative">
                <span
                  aria-hidden
                  className="pointer-events-none absolute -inset-8 hidden rounded-full bg-[radial-gradient(circle,rgba(248,244,240,0.55),rgba(248,244,240,0)_72%)] blur-3xl dark:block"
                />
                <Image
                  src="/throxy-logo.avif"
                  alt="PRS logo"
                  width={96}
                  height={42}
                  className="relative h-9 w-auto dark:invert"
                  priority
                />
              </div>
              <span className="border-primary/30 bg-primary/15 text-primary text-[10px] uppercase tracking-[0.35em] border px-2 py-1">
                PRS
              </span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-balance">
              Rank your next leads based on your spec.
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
              <Label htmlFor="min-score" className="flex items-center gap-2">
                Relevance threshold (0-1)
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="What does relevance threshold mean?"
                      className="text-muted-foreground hover:text-foreground inline-flex h-5 w-5 items-center justify-center rounded-full border border-border"
                    >
                      <CircleHelp className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    Minimum rerank score required to mark a lead as relevant. Only
                    relevant leads count toward Top N.
                  </TooltipContent>
                </Tooltip>
              </Label>
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

          {progress.status !== "idle" ? (
            <div className="border-border bg-muted/40 grid gap-3 rounded-none border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium">Ranking progress</span>
                {progress.total > 0 ? (
                  <span className="text-muted-foreground">
                    {progress.completed}/{progress.total} companies
                  </span>
                ) : (
                  <span className="text-muted-foreground">Preparing…</span>
                )}
              </div>
              <Progress value={progress.percent} />
              {progress.message ? (
                <p className="text-muted-foreground text-xs">
                  {progress.message}
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </CardContent>
      </Card>

      {isLoadingStats ? (
        <section className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Card
              key={`stats-skeleton-${index}`}
              className="border-secondary bg-secondary text-secondary-foreground ring-secondary/30"
            >
              <CardHeader className="space-y-2">
                <Skeleton className="h-3.5 w-32 bg-secondary-foreground/20" />
                <Skeleton className="h-6 w-24 bg-secondary-foreground/20" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-3 w-20 bg-secondary-foreground/20" />
              </CardContent>
            </Card>
          ))}
        </section>
      ) : stats ? (
        <section className="grid gap-4 md:grid-cols-4">
          <Card className="border-secondary bg-secondary text-secondary-foreground ring-secondary/30">
            <CardHeader className="space-y-1">
              <CardDescription className="text-secondary-foreground/80">
                Total cost (credits)
              </CardDescription>
              <CardTitle className="text-xl">
                {formatCredits(stats.totals.totalCost)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-secondary-foreground/80 text-xs">
              {formatNumber(stats.totals.callCount)} calls
            </CardContent>
          </Card>
          <Card className="border-secondary bg-secondary text-secondary-foreground ring-secondary/30">
            <CardHeader className="space-y-1">
              <CardDescription className="text-secondary-foreground/80">
                Avg cost / call (credits)
              </CardDescription>
              <CardTitle className="text-xl">
                {formatCredits(stats.totals.avgCost)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-secondary-foreground/80 text-xs">
              {formatNumber(stats.totals.inputTokens)} input tokens
            </CardContent>
          </Card>
          <Card className="border-secondary bg-secondary text-secondary-foreground ring-secondary/30">
            <CardHeader className="space-y-1">
              <CardDescription className="text-secondary-foreground/80">
                Output tokens
              </CardDescription>
              <CardTitle className="text-xl">
                {formatNumber(stats.totals.outputTokens)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-secondary-foreground/80 text-xs">
              {formatNumber(stats.totals.documents)} documents reranked
            </CardContent>
          </Card>
          <Card className="border-secondary bg-secondary text-secondary-foreground ring-secondary/30">
            <CardHeader className="space-y-1">
              <CardDescription className="text-secondary-foreground/80">
                Last run cost (credits)
              </CardDescription>
              <CardTitle className="text-xl">
                {formatCredits(stats.run?.totalCost ?? null)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-secondary-foreground/80 text-xs">
              {formatNumber(stats.run?.callCount ?? 0)} calls
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">Results</h2>
          <div className="flex flex-wrap items-center gap-3">
            {progress.status === "running" ? (
              <span className="text-muted-foreground text-xs">
                Live updates…
              </span>
            ) : null}
            {isLoadingResults ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Run ID:</span>
                <Skeleton className="h-3 w-32" />
              </div>
            ) : results?.runId ? (
              <p className="text-muted-foreground text-xs">
                Run ID: {results.runId}
              </p>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsLeaderboardDialogOpen(true)}
            >
              View prompt leaderboard
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsPromptDialogOpen(true)}
            >
              Active optimized prompt
            </Button>
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
            {Array.from({ length: 1 }).map((_, index) => (
              <Card key={`results-skeleton-${index}`} className="ring-primary/10">
                <CardHeader className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-56" />
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="overflow-hidden rounded-2xl border">
                    <div className="border-b bg-muted/40 px-4 py-2">
                      <div className="grid grid-cols-[45%_12%_10%_13%_20%] gap-3">
                        {Array.from({ length: 5 }).map((_, colIndex) => (
                          <Skeleton
                            key={`results-skeleton-header-${index}-${colIndex}`}
                            className="h-3 w-full"
                          />
                        ))}
                      </div>
                    </div>
                    <div className="divide-y">
                      {Array.from({ length: 4 }).map((_, rowIndex) => (
                        <div
                          key={`results-skeleton-row-${index}-${rowIndex}`}
                          className="grid grid-cols-[45%_12%_10%_13%_20%] items-center gap-3 px-4 py-3"
                        >
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-3 w-8 justify-self-end" />
                          <Skeleton className="h-3 w-8 justify-self-end" />
                          <Skeleton className="h-3 w-12 justify-self-end" />
                          <Skeleton className="h-7 w-14 justify-self-end" />
                        </div>
                      ))}
                    </div>
                  </div>
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
          <Card className="ring-primary/10">
            <CardHeader>
              <CardTitle>Companies</CardTitle>
              <CardDescription>
                View top contacts per company in a focused detail panel.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="overflow-hidden rounded-2xl border">
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[45%]">Company</TableHead>
                      <TableHead className="w-[12%] text-right">
                        Selected
                      </TableHead>
                      <TableHead className="w-[10%] text-right">
                        Leads
                      </TableHead>
                      <TableHead className="w-[13%] text-right">
                        Top score
                      </TableHead>
                      <TableHead className="w-[20%] text-right">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedCompanies.length ? (
                      pagedCompanies.map((company) => {
                        const selectedCount = company.leads.filter(
                          (lead) => lead.selected
                        ).length
                        const topScore = Math.max(
                          ...company.leads.map(
                            (lead) => lead.score ?? -1
                          ),
                          -1
                        )
                        return (
                          <TableRow key={company.companyId}>
                            <TableCell className="font-medium">
                              <span className="block truncate">
                                {company.companyName}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              {selectedCount}
                            </TableCell>
                            <TableCell className="text-right">
                              {company.leads.length}
                            </TableCell>
                            <TableCell className="text-right">
                              {topScore >= 0 ? topScore.toFixed(2) : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  setSelectedCompany(company)
                                  setIsCompanyDialogOpen(true)
                                }}
                              >
                                View
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="h-24 text-center">
                          No companies yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {companies.length > companyPagination.pageSize ? (
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">
                    Showing{" "}
                    {companies.length === 0
                      ? 0
                      : companyPageIndex * companyPagination.pageSize + 1}
                    –
                    {Math.min(
                      companies.length,
                      (companyPageIndex + 1) * companyPagination.pageSize
                    )}{" "}
                    of {companies.length} companies
                  </span>
                  <Pagination className="mx-0 w-auto justify-end">
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          href="#"
                          onClick={(event) => {
                            event.preventDefault()
                            if (companyPageIndex === 0) return
                            setCompanyPagination((prev) => ({
                              ...prev,
                              pageIndex: Math.max(0, prev.pageIndex - 1),
                            }))
                          }}
                          className={
                            companyPageIndex === 0
                              ? "pointer-events-none opacity-50"
                              : undefined
                          }
                        />
                      </PaginationItem>
                      {companyPageItems.map((item, index) =>
                        item === "ellipsis" ? (
                          <PaginationItem key={`company-ellipsis-${index}`}>
                            <PaginationEllipsis />
                          </PaginationItem>
                        ) : (
                          <PaginationItem key={`company-page-${item}`}>
                            <PaginationLink
                              href="#"
                              isActive={item === companyPageIndex}
                              onClick={(event) => {
                                event.preventDefault()
                                setCompanyPagination((prev) => ({
                                  ...prev,
                                  pageIndex: item,
                                }))
                              }}
                            >
                              {item + 1}
                            </PaginationLink>
                          </PaginationItem>
                        )
                      )}
                      <PaginationItem>
                        <PaginationNext
                          href="#"
                          onClick={(event) => {
                            event.preventDefault()
                            if (companyPageIndex >= companyPageCount - 1) return
                            setCompanyPagination((prev) => ({
                              ...prev,
                              pageIndex: Math.min(
                                companyPageCount - 1,
                                prev.pageIndex + 1
                              ),
                            }))
                          }}
                          className={
                            companyPageIndex >= companyPageCount - 1
                              ? "pointer-events-none opacity-50"
                              : undefined
                          }
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}
      </section>
      <Dialog
        open={isCompanyDialogOpen}
        onOpenChange={(open) => {
          setIsCompanyDialogOpen(open)
          if (!open) {
            setSelectedCompany(null)
          }
        }}
      >
        <DialogContent className="bg-card text-card-foreground max-w-[calc(100%-2rem)] w-[95vw] h-[85vh] overflow-hidden text-sm sm:max-w-6xl sm:w-[95vw]">
          {selectedCompany ? (
            <div className="flex h-full flex-col gap-4">
              <DialogHeader>
                <DialogTitle>{selectedCompany.companyName}</DialogTitle>
                <DialogDescription>
                  {selectedCompany.leads.filter((lead) => lead.selected).length}{" "}
                  selected out of {selectedCompany.leads.length} leads.
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <RankingTable
                  leads={selectedCompany.leads}
                  paginationMode="always"
                  paginationSticky
                  paginationDocked
                />
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={isLeaderboardDialogOpen}
        onOpenChange={(open) => {
          setIsLeaderboardDialogOpen(open)
          if (!open) {
            setLeaderboardError(null)
          }
        }}
      >
        <DialogContent className="bg-card text-card-foreground max-w-[calc(100%-2rem)] w-[95vw] text-sm sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Prompt leaderboard</DialogTitle>
            <DialogDescription>
              Top prompt templates from recent optimization runs.
            </DialogDescription>
          </DialogHeader>
          {isLeaderboardLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-[92%]" />
              <Skeleton className="h-4 w-[88%]" />
              <Skeleton className="h-4 w-[80%]" />
            </div>
          ) : leaderboardError ? (
            <div className="text-destructive text-sm">{leaderboardError}</div>
          ) : leaderboardEntries.length ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 text-muted-foreground text-xs">
                <span>Objective: {leaderboard?.objective ?? "—"}</span>
                <span>K: {leaderboard?.k ?? "—"}</span>
                <span>Updated: {formatDateTime(leaderboard?.updatedAt)}</span>
              </div>
              <div className="overflow-hidden rounded-2xl border">
                <Table className="table-fixed text-xs [&_td]:align-top [&_td]:py-2">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[6%] text-right">#</TableHead>
                      <TableHead className="w-[12%] text-right">
                        Objective
                      </TableHead>
                      <TableHead className="w-[9%] text-right">NDCG</TableHead>
                      <TableHead className="w-[9%] text-right">MRR</TableHead>
                      <TableHead className="w-[11%] text-right">
                        Precision
                      </TableHead>
                      <TableHead className="w-[8%] text-right">
                        Top1
                      </TableHead>
                      <TableHead className="w-[45%]">Prompt</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leaderboardEntries.map((entry, index) => {
                      const metrics = entry.testMetrics ?? entry.trainMetrics
                      return (
                        <TableRow key={`leader-${index}`}>
                          <TableCell className="text-right">
                            {index + 1}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatMetric(entry.score)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatMetric(metrics.ndcg)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatMetric(metrics.mrr)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatMetric(metrics.precision)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatMetric(metrics.top1)}
                          </TableCell>
                          <TableCell>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedLeaderboardPrompt(entry)
                                setIsLeaderboardPromptOpen(true)
                              }}
                              className="text-left text-muted-foreground line-clamp-2 hover:text-foreground"
                              title="Click to view full prompt"
                            >
                              {entry.prompt}
                            </button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
              {leaderboard?.evalPath || leaderboard?.personaPath ? (
                <div className="text-muted-foreground text-xs">
                  {leaderboard?.evalPath ? (
                    <div>Eval set: {leaderboard?.evalPath}</div>
                  ) : null}
                  {leaderboard?.personaPath ? (
                    <div>Persona spec: {leaderboard?.personaPath}</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="text-muted-foreground text-sm">
              No leaderboard data yet. Run bun run optimize:prompt to generate a
              leaderboard.
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={isPromptDialogOpen}
        onOpenChange={(open) => {
          setIsPromptDialogOpen(open)
          if (!open) {
            setPromptError(null)
          }
        }}
      >
        <DialogContent className="bg-card text-card-foreground max-w-[calc(100%-2rem)] w-[95vw] text-sm sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Active prompt template</DialogTitle>
            <DialogDescription>
              This prompt is stored in the database and used for persona-to-query
              rewriting.
            </DialogDescription>
          </DialogHeader>
          {isPromptLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-[92%]" />
              <Skeleton className="h-4 w-[88%]" />
              <Skeleton className="h-4 w-[80%]" />
              <Skeleton className="h-4 w-[86%]" />
            </div>
          ) : promptError ? (
            <div className="text-destructive text-sm">{promptError}</div>
          ) : activePrompt ? (
            <div className="max-h-[60vh] overflow-y-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
              {activePrompt}
            </div>
          ) : (
            <div className="text-muted-foreground text-sm">
              No active prompt stored.
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={isLeaderboardPromptOpen}
        onOpenChange={(open) => {
          setIsLeaderboardPromptOpen(open)
          if (!open) {
            setSelectedLeaderboardPrompt(null)
          }
        }}
      >
        <DialogContent className="bg-card text-card-foreground max-w-[calc(100%-2rem)] w-[95vw] text-sm sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Prompt template</DialogTitle>
            <DialogDescription>
              Full prompt text for the selected leaderboard entry.
            </DialogDescription>
          </DialogHeader>
          {selectedLeaderboardPrompt ? (
            <div className="max-h-[60vh] overflow-y-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
              {selectedLeaderboardPrompt.prompt}
            </div>
          ) : (
            <div className="text-muted-foreground text-sm">
              No prompt selected.
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

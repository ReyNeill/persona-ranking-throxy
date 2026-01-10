"use client"

import * as React from "react"

import {
  useRankingResults,
  useRankingStats,
  useRankingStream,
  useActivePrompt,
  usePromptLeaderboard,
  useLeaderboardPromptDialog,
} from "@/hooks"
import {
  RankingHeader,
  RankingControls,
  StatsCards,
  CompanyTable,
  CompanyDialog,
  LeaderboardDialog,
  ActivePromptDialog,
  LeaderboardPromptDialog,
} from "@/components/ranking"
import type { RankingResponse, CompanyResult } from "@/components/ranking-types"
import { escapeCsv } from "@/lib/utils"

export function RankingClient() {
  // Data fetching hooks
  const { results, setResults, isLoading: isLoadingResults, setIsLoading: setIsLoadingResults } =
    useRankingResults()
  const { stats, isLoading: isLoadingStats, refresh: refreshStats } = useRankingStats({
    runId: results?.runId,
    waitForResults: isLoadingResults,
  })

  // Streaming hook
  const { isRunning, isUploading, error, progress, ingestionProgress, runRanking } = useRankingStream({
    onResults: setResults,
    onLoadingChange: setIsLoadingResults,
    onStatsRefresh: refreshStats,
  })

  // Dialog states
  const [selectedCompany, setSelectedCompany] = React.useState<CompanyResult | null>(null)
  const [isCompanyDialogOpen, setIsCompanyDialogOpen] = React.useState(false)
  const [isPromptDialogOpen, setIsPromptDialogOpen] = React.useState(false)
  const [isLeaderboardDialogOpen, setIsLeaderboardDialogOpen] = React.useState(false)

  // Prompt hooks
  const {
    prompt: activePrompt,
    isLoading: isPromptLoading,
    error: promptError,
    setError: setPromptError,
  } = useActivePrompt(isPromptDialogOpen)

  const {
    leaderboard,
    sortedEntries: leaderboardEntries,
    isLoading: isLeaderboardLoading,
    error: leaderboardError,
    setError: setLeaderboardError,
  } = usePromptLeaderboard(isLeaderboardDialogOpen)

  const {
    isOpen: isLeaderboardPromptOpen,
    selected: selectedLeaderboardPrompt,
    open: openLeaderboardPrompt,
    close: closeLeaderboardPrompt,
    setIsOpen: setIsLeaderboardPromptOpen,
  } = useLeaderboardPromptDialog()

  // CSV export
  const exportTopN = results?.topN ?? 3
  const exportableCount =
    results?.companies?.reduce((count, company) => {
      const companyCount = company.leads.filter(
        (lead) => lead.rank !== null && lead.rank <= exportTopN
      ).length
      return count + companyCount
    }, 0) ?? 0

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

  // Handle run ranking with CSV file
  const handleRun = React.useCallback(
    (params: {
      personaSpec: string
      topN: number
      minScore: number
      csvFile: File | null
    }) => {
      setSelectedCompany(null)
      setIsCompanyDialogOpen(false)
      runRanking(
        {
          personaSpec: params.personaSpec,
          topN: params.topN,
          minScore: params.minScore,
          ingestionId: null,
        },
        params.csvFile
      )
    },
    [runRanking]
  )

  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-12">
      <RankingHeader />

      <RankingControls
        onRun={handleRun}
        isRunning={isRunning}
        isUploading={isUploading}
        progress={progress}
        ingestionProgress={ingestionProgress}
        error={error}
      />

      <StatsCards stats={stats} isLoading={isLoadingStats} />

      <CompanyTable
        results={results}
        isLoading={isLoadingResults}
        isStreaming={progress.status === "running"}
        onViewCompany={(company) => {
          setSelectedCompany(company)
          setIsCompanyDialogOpen(true)
        }}
        onExport={exportSelectedToCsv}
        exportableCount={exportableCount}
        onOpenLeaderboard={() => setIsLeaderboardDialogOpen(true)}
        onOpenPrompt={() => setIsPromptDialogOpen(true)}
      />

      <CompanyDialog
        company={selectedCompany}
        isOpen={isCompanyDialogOpen}
        onOpenChange={(open) => {
          setIsCompanyDialogOpen(open)
          if (!open) setSelectedCompany(null)
        }}
        results={results}
      />

      <LeaderboardDialog
        isOpen={isLeaderboardDialogOpen}
        onOpenChange={(open) => {
          setIsLeaderboardDialogOpen(open)
          if (!open) setLeaderboardError(null)
        }}
        leaderboard={leaderboard}
        sortedEntries={leaderboardEntries}
        isLoading={isLeaderboardLoading}
        error={leaderboardError}
        onSelectEntry={openLeaderboardPrompt}
      />

      <ActivePromptDialog
        isOpen={isPromptDialogOpen}
        onOpenChange={(open) => {
          setIsPromptDialogOpen(open)
          if (!open) setPromptError(null)
        }}
        prompt={activePrompt}
        isLoading={isPromptLoading}
        error={promptError}
      />

      <LeaderboardPromptDialog
        isOpen={isLeaderboardPromptOpen}
        onOpenChange={(open) => {
          setIsLeaderboardPromptOpen(open)
          if (!open) closeLeaderboardPrompt()
        }}
        entry={selectedLeaderboardPrompt}
      />
    </div>
  )
}

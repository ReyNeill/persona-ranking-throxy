"use client"

import * as React from "react"
import { toast } from "sonner"
import type {
  RankingResponse,
  RankingProgress,
  RankingStreamEvent,
} from "@/components/ranking-types"

type RankingParams = {
  personaSpec: string
  topN: number
  minScore: number
  ingestionId: string | null
}

type IngestionProgress = {
  status: string
  processedRows: number
  totalRows: number
  percentage: number
  leadCount: number
  companyCount: number
  skippedCount: number
  currentPhase: string
}

type UseRankingStreamOptions = {
  onResults: React.Dispatch<React.SetStateAction<RankingResponse | null>>
  onLoadingChange: (loading: boolean) => void
  onStatsRefresh: () => void
}

const INITIAL_PROGRESS: RankingProgress = {
  status: "idle",
  percent: 0,
  total: 0,
  completed: 0,
  message: "",
}

const INITIAL_INGESTION_PROGRESS: IngestionProgress = {
  status: "idle",
  processedRows: 0,
  totalRows: 0,
  percentage: 0,
  leadCount: 0,
  companyCount: 0,
  skippedCount: 0,
  currentPhase: "",
}

// Poll for ingestion completion
async function waitForIngestion(
  ingestionId: string,
  onProgress: (progress: IngestionProgress) => void
): Promise<{ leadCount: number; companyCount: number; skippedCount: number }> {
  const pollInterval = 1000 // 1 second
  const maxPolls = 600 // 10 minutes max

  for (let i = 0; i < maxPolls; i++) {
    const response = await fetch(`/api/ingest/${ingestionId}`)
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error ?? "Failed to check ingestion status")
    }

    onProgress({
      status: data.status,
      processedRows: data.processedRows ?? 0,
      totalRows: data.totalRows ?? 0,
      percentage:
        data.totalRows > 0
          ? Math.round((data.processedRows / data.totalRows) * 100)
          : 0,
      leadCount: data.leadCount ?? 0,
      companyCount: data.companyCount ?? 0,
      skippedCount: data.skippedCount ?? 0,
      currentPhase:
        data.status === "processing"
          ? `Processing ${data.processedRows?.toLocaleString() ?? 0}/${data.totalRows?.toLocaleString() ?? 0} rows`
          : data.status === "completed"
            ? "Import complete"
            : data.status === "failed"
              ? `Error: ${data.errorMessage}`
              : "Preparing...",
    })

    if (data.status === "completed") {
      return {
        leadCount: data.leadCount ?? 0,
        companyCount: data.companyCount ?? 0,
        skippedCount: data.skippedCount ?? 0,
      }
    }

    if (data.status === "failed") {
      throw new Error(data.errorMessage ?? "Ingestion failed")
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval))
  }

  throw new Error("Ingestion timeout - please try again")
}

export function useRankingStream(options: UseRankingStreamOptions) {
  const { onResults, onLoadingChange, onStatsRefresh } = options
  const [isRunning, setIsRunning] = React.useState(false)
  const [isUploading, setIsUploading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [progress, setProgress] =
    React.useState<RankingProgress>(INITIAL_PROGRESS)
  const [ingestionProgress, setIngestionProgress] =
    React.useState<IngestionProgress>(INITIAL_INGESTION_PROGRESS)

  const runRanking = React.useCallback(
    async (params: RankingParams, csvFile: File | null) => {
      const { personaSpec, topN, minScore } = params
      let { ingestionId } = params

      setIsRunning(true)
      onLoadingChange(true)
      setError(null)
      onResults(null)
      setProgress({
        status: "running",
        percent: 0,
        total: 0,
        completed: 0,
        message: "Preparing ranking...",
      })
      setIngestionProgress(INITIAL_INGESTION_PROGRESS)

      try {
        const trimmedSpec = personaSpec.trim()

        // Handle CSV upload if provided
        if (csvFile) {
          setIsUploading(true)
          setIngestionProgress({
            status: "uploading",
            processedRows: 0,
            totalRows: 0,
            percentage: 0,
            leadCount: 0,
            companyCount: 0,
            skippedCount: 0,
            currentPhase: "Uploading CSV...",
          })

          const formData = new FormData()
          formData.append("file", csvFile)

          const ingestResponse = await fetch("/api/ingest", {
            method: "POST",
            body: formData,
          })
          const ingestData = await ingestResponse.json()

          if (!ingestResponse.ok) {
            throw new Error(ingestData.error ?? "Failed to upload CSV")
          }

          const newIngestionId = ingestData.ingestionId as string
          ingestionId = newIngestionId

          // Wait for background processing to complete
          setIngestionProgress((prev) => ({
            ...prev,
            status: "processing",
            currentPhase: "Processing CSV in background...",
          }))

          const result = await waitForIngestion(
            newIngestionId,
            setIngestionProgress
          )

          toast.success("Leads uploaded", {
            description: `Loaded ${result.leadCount.toLocaleString()} leads from ${csvFile.name} (${result.companyCount.toLocaleString()} companies, ${result.skippedCount.toLocaleString()} skipped).`,
          })
          setIsUploading(false)
        }

        // Start streaming ranking
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
            onResults({
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
            onResults((prev) => {
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
            onLoadingChange(false)
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
            onStatsRefresh()
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
                const parsedEvent = JSON.parse(json) as RankingStreamEvent
                handleEvent(parsedEvent)
              } catch {
                // Ignore malformed events
              }
            }
            boundaryIndex = buffer.indexOf("\n\n")
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error"
        setError(message)
        toast.error("Ranking failed", { description: message })
        setProgress((prev) => ({
          ...prev,
          status: "error",
          message,
        }))
      } finally {
        setIsRunning(false)
        setIsUploading(false)
        onLoadingChange(false)
      }
    },
    [onResults, onLoadingChange, onStatsRefresh]
  )

  return {
    isRunning,
    isUploading,
    error,
    progress,
    ingestionProgress,
    runRanking,
    setError,
  }
}

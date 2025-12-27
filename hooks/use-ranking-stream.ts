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

export function useRankingStream(options: UseRankingStreamOptions) {
  const { onResults, onLoadingChange, onStatsRefresh } = options
  const [isRunning, setIsRunning] = React.useState(false)
  const [isUploading, setIsUploading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [progress, setProgress] = React.useState<RankingProgress>(INITIAL_PROGRESS)

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

      try {
        const trimmedSpec = personaSpec.trim()

        // Handle CSV upload if provided
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
    runRanking,
    setError,
  }
}


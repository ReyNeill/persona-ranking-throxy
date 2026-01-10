"use client"

import * as React from "react"
import { useRealtimeRun } from "@trigger.dev/react-hooks"
import type { csvImportTask } from "@/trigger/csv-import"

type IngestionStatus =
  | "idle"
  | "pending"
  | "uploading"
  | "processing"
  | "completed"
  | "failed"

type IngestionProgress = {
  status: IngestionStatus
  totalRows: number
  processedRows: number
  percentage: number
  currentPhase: string
  companiesProcessed: number
  leadsInserted: number
  skippedRows: number
}

type UseIngestionProgressOptions = {
  ingestionId: string | null
  runId: string | null
}

type UseIngestionProgressReturn = {
  progress: IngestionProgress
  isLoading: boolean
  error: string | null
  isComplete: boolean
  isFailed: boolean
}

const defaultProgress: IngestionProgress = {
  status: "idle",
  totalRows: 0,
  processedRows: 0,
  percentage: 0,
  currentPhase: "",
  companiesProcessed: 0,
  leadsInserted: 0,
  skippedRows: 0,
}

export function useIngestionProgress({
  ingestionId,
  runId,
}: UseIngestionProgressOptions): UseIngestionProgressReturn {
  const [publicToken, setPublicToken] = React.useState<string | null>(null)
  const [isLoadingToken, setIsLoadingToken] = React.useState(false)
  const [tokenError, setTokenError] = React.useState<string | null>(null)

  // Fetch public token when we have a runId
  React.useEffect(() => {
    if (!runId) {
      setPublicToken(null)
      setTokenError(null)
      return
    }

    setIsLoadingToken(true)
    setTokenError(null)

    fetch("/api/trigger/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to get token")
        return res.json()
      })
      .then((data) => setPublicToken(data.token))
      .catch((err) => {
        setTokenError(err.message)
        setPublicToken(null)
      })
      .finally(() => setIsLoadingToken(false))
  }, [runId])

  // Subscribe to realtime updates
  const { run, error: realtimeError } = useRealtimeRun<typeof csvImportTask>(
    runId ?? "",
    {
      accessToken: publicToken ?? "",
      enabled: Boolean(runId && publicToken),
    }
  )

  const progress = React.useMemo<IngestionProgress>(() => {
    if (!run?.metadata) {
      return defaultProgress
    }

    const meta = run.metadata as { progress?: IngestionProgress }
    if (!meta.progress) {
      return defaultProgress
    }

    return {
      status: meta.progress.status ?? "idle",
      totalRows: meta.progress.totalRows ?? 0,
      processedRows: meta.progress.processedRows ?? 0,
      percentage: meta.progress.percentage ?? 0,
      currentPhase: meta.progress.currentPhase ?? "",
      companiesProcessed: meta.progress.companiesProcessed ?? 0,
      leadsInserted: meta.progress.leadsInserted ?? 0,
      skippedRows: meta.progress.skippedRows ?? 0,
    }
  }, [run?.metadata])

  const error = tokenError ?? realtimeError?.message ?? null

  return {
    progress,
    isLoading: isLoadingToken,
    error,
    isComplete: progress.status === "completed",
    isFailed: progress.status === "failed",
  }
}

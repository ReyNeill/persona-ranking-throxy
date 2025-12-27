"use client"

import * as React from "react"
import type { StatsResponse } from "@/components/ranking-types"

type UseRankingStatsOptions = {
  runId: string | null | undefined
  /** Wait for this to be false before fetching (prevents double-fetch on initial load) */
  waitForResults?: boolean
}

export function useRankingStats(options: UseRankingStatsOptions) {
  const { runId, waitForResults = false } = options
  const [stats, setStats] = React.useState<StatsResponse | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [version, setVersion] = React.useState(0)

  const refresh = React.useCallback(() => {
    setVersion((v) => v + 1)
  }, [])

  React.useEffect(() => {
    // Don't fetch until results have loaded (avoids double-fetch)
    if (waitForResults) return

    let isMounted = true
    const params = runId ? `?runId=${runId}` : ""
    setIsLoading(true)
    fetch(`/api/stats${params}`)
      .then((res) => res.json())
      .then((data: StatsResponse) => {
        if (isMounted && data?.totals) {
          setStats(data)
        }
      })
      .catch(() => null)
      .finally(() => {
        if (isMounted) setIsLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [runId, version, waitForResults])

  return { stats, setStats, isLoading, refresh }
}


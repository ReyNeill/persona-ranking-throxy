"use client"

import * as React from "react"
import type { StatsResponse } from "@/components/ranking-types"

export function useRankingStats(runId: string | null | undefined) {
  const [stats, setStats] = React.useState<StatsResponse | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [version, setVersion] = React.useState(0)

  const refresh = React.useCallback(() => {
    setVersion((v) => v + 1)
  }, [])

  React.useEffect(() => {
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
  }, [runId, version])

  return { stats, setStats, isLoading, refresh }
}


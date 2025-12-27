"use client"

import * as React from "react"
import type { RankingResponse } from "@/components/ranking-types"

export function useRankingResults() {
  const [results, setResults] = React.useState<RankingResponse | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)

  React.useEffect(() => {
    let isMounted = true
    setIsLoading(true)
    fetch("/api/results")
      .then((res) => res.json())
      .then((data: RankingResponse) => {
        if (isMounted) setResults(data)
      })
      .catch(() => null)
      .finally(() => {
        if (isMounted) setIsLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [])

  return { results, setResults, isLoading, setIsLoading }
}


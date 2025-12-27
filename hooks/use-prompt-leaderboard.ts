"use client"

import * as React from "react"
import type { PromptLeaderboard, PromptLeaderboardEntry } from "@/components/ranking-types"

export function usePromptLeaderboard(isOpen: boolean) {
  const [leaderboard, setLeaderboard] = React.useState<PromptLeaderboard | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!isOpen) return
    let isMounted = true
    setIsLoading(true)
    setError(null)
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
        setError(err instanceof Error ? err.message : "Failed to load.")
      })
      .finally(() => {
        if (!isMounted) return
        setIsLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [isOpen])

  const sortedEntries = React.useMemo(() => {
    const entries = leaderboard?.entries ?? []
    return [...entries].sort((a, b) => {
      const aScore = Number.isFinite(a.score) ? a.score : -Infinity
      const bScore = Number.isFinite(b.score) ? b.score : -Infinity
      if (aScore !== bScore) return bScore - aScore
      return (a.prompt ?? "").localeCompare(b.prompt ?? "")
    })
  }, [leaderboard?.entries])

  return { leaderboard, sortedEntries, isLoading, error, setError }
}

export function useLeaderboardPromptDialog() {
  const [isOpen, setIsOpen] = React.useState(false)
  const [selected, setSelected] = React.useState<PromptLeaderboardEntry | null>(null)

  const open = React.useCallback((entry: PromptLeaderboardEntry) => {
    setSelected(entry)
    setIsOpen(true)
  }, [])

  const close = React.useCallback(() => {
    setIsOpen(false)
    setSelected(null)
  }, [])

  return { isOpen, selected, open, close, setIsOpen }
}


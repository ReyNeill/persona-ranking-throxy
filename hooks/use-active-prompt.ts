"use client"

import * as React from "react"

export function useActivePrompt(isOpen: boolean) {
  const [prompt, setPrompt] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!isOpen) return
    let isMounted = true
    setIsLoading(true)
    setError(null)
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
        setPrompt(data.prompt ?? null)
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

  return { prompt, isLoading, error, setError }
}


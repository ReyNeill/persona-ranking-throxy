"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import type { PromptLeaderboardEntry } from "@/components/ranking-types"

type ActivePromptDialogProps = {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  prompt: string | null
  isLoading: boolean
  error: string | null
}

export function ActivePromptDialog({
  isOpen,
  onOpenChange,
  prompt,
  isLoading,
  error,
}: ActivePromptDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card text-card-foreground max-w-[calc(100%-2rem)] w-[95vw] text-sm sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Active prompt template</DialogTitle>
          <DialogDescription>
            This prompt is stored in the database and used for persona-to-query rewriting.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-[92%]" />
            <Skeleton className="h-4 w-[88%]" />
            <Skeleton className="h-4 w-[80%]" />
            <Skeleton className="h-4 w-[86%]" />
          </div>
        ) : error ? (
          <div className="text-destructive text-sm">{error}</div>
        ) : prompt ? (
          <div className="max-h-[60vh] overflow-y-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
            {prompt}
          </div>
        ) : (
          <div className="text-muted-foreground text-sm">No active prompt stored.</div>
        )}
      </DialogContent>
    </Dialog>
  )
}

type LeaderboardPromptDialogProps = {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  entry: PromptLeaderboardEntry | null
}

export function LeaderboardPromptDialog({
  isOpen,
  onOpenChange,
  entry,
}: LeaderboardPromptDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card text-card-foreground max-w-[calc(100%-2rem)] w-[95vw] text-sm sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Prompt template</DialogTitle>
          <DialogDescription>
            Full prompt text for the selected leaderboard entry.
          </DialogDescription>
        </DialogHeader>
        {entry ? (
          <div className="max-h-[60vh] overflow-y-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
            {entry.prompt}
          </div>
        ) : (
          <div className="text-muted-foreground text-sm">No prompt selected.</div>
        )}
      </DialogContent>
    </Dialog>
  )
}


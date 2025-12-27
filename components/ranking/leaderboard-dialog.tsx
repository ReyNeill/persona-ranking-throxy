"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { PromptLeaderboard, PromptLeaderboardEntry } from "@/components/ranking-types"
import { formatMetric, formatDateTime } from "@/lib/utils"

type LeaderboardDialogProps = {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  leaderboard: PromptLeaderboard | null
  sortedEntries: PromptLeaderboardEntry[]
  isLoading: boolean
  error: string | null
  onSelectEntry: (entry: PromptLeaderboardEntry) => void
}

export function LeaderboardDialog({
  isOpen,
  onOpenChange,
  leaderboard,
  sortedEntries,
  isLoading,
  error,
  onSelectEntry,
}: LeaderboardDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card text-card-foreground max-w-[calc(100%-2rem)] w-[95vw] text-sm sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Prompt leaderboard</DialogTitle>
          <DialogDescription>
            Top prompt templates from recent optimization runs.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-[92%]" />
            <Skeleton className="h-4 w-[88%]" />
            <Skeleton className="h-4 w-[80%]" />
          </div>
        ) : error ? (
          <div className="text-destructive text-sm">{error}</div>
        ) : sortedEntries.length ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 text-muted-foreground text-xs">
              <span>Objective: {leaderboard?.objective ?? "—"}</span>
              <span>K: {leaderboard?.k ?? "—"}</span>
              <span>Updated: {formatDateTime(leaderboard?.updatedAt)}</span>
            </div>
            <div className="overflow-hidden rounded-2xl border">
              <Table className="table-fixed text-xs [&_td]:align-top [&_td]:py-2">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[6%] text-right">#</TableHead>
                    <TableHead className="w-[12%] text-right">Objective</TableHead>
                    <TableHead className="w-[9%] text-right">NDCG</TableHead>
                    <TableHead className="w-[9%] text-right">MRR</TableHead>
                    <TableHead className="w-[11%] text-right">Precision</TableHead>
                    <TableHead className="w-[8%] text-right">Top1</TableHead>
                    <TableHead className="w-[45%]">Prompt</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedEntries.map((entry, index) => {
                    const metrics = entry.testMetrics ?? entry.trainMetrics
                    return (
                      <TableRow key={`leader-${index}`}>
                        <TableCell className="text-right">{index + 1}</TableCell>
                        <TableCell className="text-right">
                          {formatMetric(entry.score)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMetric(metrics.ndcg)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMetric(metrics.mrr)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMetric(metrics.precision)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMetric(metrics.top1)}
                        </TableCell>
                        <TableCell>
                          <button
                            type="button"
                            onClick={() => onSelectEntry(entry)}
                            className="text-left text-muted-foreground line-clamp-2 hover:text-foreground"
                            title="Click to view full prompt"
                          >
                            {entry.prompt}
                          </button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            {leaderboard?.evalPath || leaderboard?.personaPath ? (
              <div className="text-muted-foreground text-xs">
                {leaderboard?.evalPath ? (
                  <div>Eval set: {leaderboard.evalPath}</div>
                ) : null}
                {leaderboard?.personaPath ? (
                  <div>Persona spec: {leaderboard.personaPath}</div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="text-muted-foreground text-sm">
            No leaderboard data yet. Run bun run optimize:prompt to generate a leaderboard.
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}


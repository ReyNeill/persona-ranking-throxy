"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { StatsResponse } from "@/components/ranking-types"
import { formatCredits, formatNumber } from "@/lib/utils"

type StatsCardsProps = {
  stats: StatsResponse | null
  isLoading: boolean
}

function StatsSkeleton() {
  return (
    <section className="grid gap-4 md:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <Card
          key={`stats-skeleton-${index}`}
          className="border-secondary bg-secondary text-secondary-foreground ring-secondary/30"
        >
          <CardHeader className="space-y-2">
            <Skeleton className="h-3.5 w-32 bg-secondary-foreground/20" />
            <Skeleton className="h-6 w-24 bg-secondary-foreground/20" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-3 w-20 bg-secondary-foreground/20" />
          </CardContent>
        </Card>
      ))}
    </section>
  )
}

export function StatsCards({ stats, isLoading }: StatsCardsProps) {
  if (isLoading) {
    return <StatsSkeleton />
  }

  if (!stats) {
    return null
  }

  return (
    <section className="grid gap-4 md:grid-cols-4">
      <Card className="border-secondary bg-secondary text-secondary-foreground ring-secondary/30">
        <CardHeader className="space-y-1">
          <CardDescription className="text-secondary-foreground/80">
            Total cost (credits)
          </CardDescription>
          <CardTitle className="text-xl">
            {formatCredits(stats.totals.totalCost)}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-secondary-foreground/80 text-xs">
          {formatNumber(stats.totals.callCount)} calls
        </CardContent>
      </Card>
      <Card className="border-secondary bg-secondary text-secondary-foreground ring-secondary/30">
        <CardHeader className="space-y-1">
          <CardDescription className="text-secondary-foreground/80">
            Avg cost / call (credits)
          </CardDescription>
          <CardTitle className="text-xl">
            {formatCredits(stats.totals.avgCost)}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-secondary-foreground/80 text-xs">
          {formatNumber(stats.totals.inputTokens)} input tokens
        </CardContent>
      </Card>
      <Card className="border-secondary bg-secondary text-secondary-foreground ring-secondary/30">
        <CardHeader className="space-y-1">
          <CardDescription className="text-secondary-foreground/80">
            Output tokens
          </CardDescription>
          <CardTitle className="text-xl">
            {formatNumber(stats.totals.outputTokens)}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-secondary-foreground/80 text-xs">
          {formatNumber(stats.totals.documents)} documents reranked
        </CardContent>
      </Card>
      <Card className="border-secondary bg-secondary text-secondary-foreground ring-secondary/30">
        <CardHeader className="space-y-1">
          <CardDescription className="text-secondary-foreground/80">
            Last run cost (credits)
          </CardDescription>
          <CardTitle className="text-xl">
            {formatCredits(stats.run?.totalCost ?? null)}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-secondary-foreground/80 text-xs">
          {formatNumber(stats.run?.callCount ?? 0)} calls
        </CardContent>
      </Card>
    </section>
  )
}


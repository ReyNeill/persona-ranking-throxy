"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import type { RankingResponse, CompanyResult } from "@/components/ranking-types"

type CompanyTableProps = {
  results: RankingResponse | null
  isLoading: boolean
  isStreaming: boolean
  onViewCompany: (company: CompanyResult) => void
  onExport: () => void
  exportableCount: number
  onOpenLeaderboard: () => void
  onOpenPrompt: () => void
}

const PAGE_SIZE = 4

function ResultsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Card className="ring-primary/10">
        <CardHeader className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-56" />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="overflow-hidden rounded-2xl border">
            <div className="border-b bg-muted/40 px-4 py-2">
              <div className="grid grid-cols-[45%_12%_10%_13%_20%] gap-3">
                {Array.from({ length: 5 }).map((_, colIndex) => (
                  <Skeleton key={`header-${colIndex}`} className="h-3 w-full" />
                ))}
              </div>
            </div>
            <div className="divide-y">
              {Array.from({ length: 4 }).map((_, rowIndex) => (
                <div
                  key={`row-${rowIndex}`}
                  className="grid grid-cols-[45%_12%_10%_13%_20%] items-center gap-3 px-4 py-3"
                >
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-8 justify-self-end" />
                  <Skeleton className="h-3 w-8 justify-self-end" />
                  <Skeleton className="h-3 w-12 justify-self-end" />
                  <Skeleton className="h-7 w-14 justify-self-end" />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export function CompanyTable({
  results,
  isLoading,
  isStreaming,
  onViewCompany,
  onExport,
  exportableCount,
  onOpenLeaderboard,
  onOpenPrompt,
}: CompanyTableProps) {
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: PAGE_SIZE })

  // Reset pagination when results change
  React.useEffect(() => {
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
  }, [results?.runId])

  const companies = React.useMemo(() => {
    const list = results?.companies ?? []
    return [...list].sort((a, b) => {
      const aSelected = a.leads.filter((lead) => lead.selected).length
      const bSelected = b.leads.filter((lead) => lead.selected).length
      if (aSelected !== bSelected) return bSelected - aSelected
      const aTopScore = Math.max(...a.leads.map((lead) => lead.score ?? -1), -1)
      const bTopScore = Math.max(...b.leads.map((lead) => lead.score ?? -1), -1)
      if (aTopScore !== bTopScore) return bTopScore - aTopScore
      const nameSort = a.companyName.localeCompare(b.companyName)
      if (nameSort !== 0) return nameSort
      return a.companyId.localeCompare(b.companyId)
    })
  }, [results?.companies])

  const pageCount = Math.max(1, Math.ceil(companies.length / pagination.pageSize))
  const pageIndex = Math.min(pagination.pageIndex, pageCount - 1)
  const pagedCompanies = companies.slice(
    pageIndex * pagination.pageSize,
    (pageIndex + 1) * pagination.pageSize
  )

  // Sync page index if it goes out of bounds
  React.useEffect(() => {
    if (pagination.pageIndex !== pageIndex) {
      setPagination((prev) => ({ ...prev, pageIndex }))
    }
  }, [pageIndex, pagination.pageIndex])

  const pageItems = React.useMemo(() => {
    if (pageCount <= 7) {
      return Array.from({ length: pageCount }, (_, index) => index)
    }
    const items: Array<number | "ellipsis"> = [0]
    const start = Math.max(1, pageIndex - 1)
    const end = Math.min(pageCount - 2, pageIndex + 1)
    if (start > 1) items.push("ellipsis")
    for (let i = start; i <= end; i += 1) items.push(i)
    if (end < pageCount - 2) items.push("ellipsis")
    items.push(pageCount - 1)
    return items
  }, [pageCount, pageIndex])

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Results</h2>
        <div className="flex flex-wrap items-center gap-3">
          {isStreaming ? (
            <span className="text-muted-foreground text-xs">Live updates...</span>
          ) : null}
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Run ID:</span>
              <Skeleton className="h-3 w-32" />
            </div>
          ) : results?.runId ? (
            <p className="text-muted-foreground text-xs">Run ID: {results.runId}</p>
          ) : null}
          <Button variant="outline" size="sm" onClick={onOpenLeaderboard}>
            View prompt leaderboard
          </Button>
          <Button variant="outline" size="sm" onClick={onOpenPrompt}>
            Active optimized prompt
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={onExport}
            disabled={exportableCount === 0}
          >
            Export top leads CSV
          </Button>
        </div>
      </div>

      {isLoading ? (
        <ResultsSkeleton />
      ) : !results?.companies?.length ? (
        <Card>
          <CardContent className="text-muted-foreground py-6 text-sm">
            No rankings yet. Load a CSV and run the ranking to see results.
          </CardContent>
        </Card>
      ) : (
        <Card className="ring-primary/10">
          <CardHeader>
            <CardTitle>Companies</CardTitle>
            <CardDescription>
              View top contacts per company in a focused detail panel.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-hidden rounded-2xl border">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[45%]">Company</TableHead>
                    <TableHead className="w-[12%] text-right">Selected</TableHead>
                    <TableHead className="w-[10%] text-right">Leads</TableHead>
                    <TableHead className="w-[13%] text-right">Top score</TableHead>
                    <TableHead className="w-[20%] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedCompanies.length ? (
                    pagedCompanies.map((company) => {
                      const selectedCount = company.leads.filter((lead) => lead.selected).length
                      const topScore = Math.max(
                        ...company.leads.map((lead) => lead.score ?? -1),
                        -1
                      )
                      return (
                        <TableRow key={company.companyId}>
                          <TableCell className="font-medium">
                            <span className="block truncate">{company.companyName}</span>
                          </TableCell>
                          <TableCell className="text-right">{selectedCount}</TableCell>
                          <TableCell className="text-right">{company.leads.length}</TableCell>
                          <TableCell className="text-right">
                            {topScore >= 0 ? topScore.toFixed(2) : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => onViewCompany(company)}
                            >
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center">
                        No companies yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {companies.length > pagination.pageSize ? (
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">
                  Showing {companies.length === 0 ? 0 : pageIndex * pagination.pageSize + 1}–
                  {Math.min(companies.length, (pageIndex + 1) * pagination.pageSize)} of{" "}
                  {companies.length} companies
                </span>
                <Pagination className="mx-0 w-auto justify-end">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        onClick={(event) => {
                          event.preventDefault()
                          if (pageIndex === 0) return
                          setPagination((prev) => ({
                            ...prev,
                            pageIndex: Math.max(0, prev.pageIndex - 1),
                          }))
                        }}
                        className={pageIndex === 0 ? "pointer-events-none opacity-50" : undefined}
                      />
                    </PaginationItem>
                    {pageItems.map((item, idx) =>
                      item === "ellipsis" ? (
                        <PaginationItem key={`ellipsis-${idx}`}>
                          <PaginationEllipsis />
                        </PaginationItem>
                      ) : (
                        <PaginationItem key={`page-${item}`}>
                          <PaginationLink
                            href="#"
                            isActive={item === pageIndex}
                            onClick={(event) => {
                              event.preventDefault()
                              setPagination((prev) => ({ ...prev, pageIndex: item }))
                            }}
                          >
                            {item + 1}
                          </PaginationLink>
                        </PaginationItem>
                      )
                    )}
                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        onClick={(event) => {
                          event.preventDefault()
                          if (pageIndex >= pageCount - 1) return
                          setPagination((prev) => ({
                            ...prev,
                            pageIndex: Math.min(pageCount - 1, prev.pageIndex + 1),
                          }))
                        }}
                        className={
                          pageIndex >= pageCount - 1 ? "pointer-events-none opacity-50" : undefined
                        }
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </section>
  )
}


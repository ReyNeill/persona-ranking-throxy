"use client"

import * as React from "react"
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type SortingFn,
} from "@tanstack/react-table"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { LeadResult } from "@/components/ranking-types"

type RankingTableProps = {
  leads: LeadResult[]
  paginationMode?: "auto" | "always" | "hidden"
  paginationSticky?: boolean
  paginationDocked?: boolean
}

const scoreSort: SortingFn<LeadResult> = (rowA, rowB) => {
  const a = rowA.original.score ?? -1
  const b = rowB.original.score ?? -1
  return a === b ? 0 : a > b ? 1 : -1
}

export function RankingTable({
  leads,
  paginationMode = "auto",
  paginationSticky = false,
  paginationDocked = false,
}: RankingTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "score", desc: true },
  ])
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: 9,
  })

  const data = React.useMemo(() => leads, [leads])

  React.useEffect(() => {
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
  }, [data.length])

  const pageItems = React.useMemo(() => {
    const pageCount = Math.max(1, Math.ceil(data.length / pagination.pageSize))
    const current = pagination.pageIndex
    if (pageCount <= 7) {
      return Array.from({ length: pageCount }, (_, index) => index)
    }

    const items: Array<number | "ellipsis"> = [0]
    const start = Math.max(1, current - 1)
    const end = Math.min(pageCount - 2, current + 1)

    if (start > 1) items.push("ellipsis")
    for (let i = start; i <= end; i += 1) items.push(i)
    if (end < pageCount - 2) items.push("ellipsis")
    items.push(pageCount - 1)

    return items
  }, [data.length, pagination.pageIndex, pagination.pageSize])

  const shouldShowPagination =
    paginationMode === "always" ||
    (paginationMode !== "hidden" && data.length > pagination.pageSize)

  const columns = React.useMemo<ColumnDef<LeadResult>[]>(
    () => [
      {
        id: "lead",
        header: "Lead",
        cell: ({ row }) => {
          const lead = row.original
          return (
            <div className="space-y-1">
              <div className="font-medium">{lead.fullName ?? "Unknown"}</div>
              <div className="text-muted-foreground text-xs">
                {lead.email ?? lead.linkedinUrl ?? "No contact"}
              </div>
            </div>
          )
        },
      },
      {
        accessorKey: "title",
        header: "Title",
        cell: ({ row }) => row.original.title ?? "Unknown",
      },
      {
        accessorKey: "rank",
        header: ({ column }) => {
          const sort = column.getIsSorted()
          return (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
            >
              Rank
              <span className="text-muted-foreground ml-1 text-xs">
                {sort === "asc" ? "^" : sort === "desc" ? "v" : ""}
              </span>
            </Button>
          )
        },
        cell: ({ row }) => row.original.rank ?? "—",
        sortingFn: "basic",
      },
      {
        accessorKey: "score",
        header: ({ column }) => {
          const sort = column.getIsSorted()
          return (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
            >
              Score
              <span className="text-muted-foreground ml-1 text-xs">
                {sort === "asc" ? "^" : sort === "desc" ? "v" : ""}
              </span>
            </Button>
          )
        },
        cell: ({ row }) => {
          const score = row.original.score
          return score !== null ? score.toFixed(2) : "—"
        },
        sortingFn: scoreSort,
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => {
          const lead = row.original
          const label = lead.selected
            ? "Selected"
            : lead.relevance ?? "—"
          const variant = lead.selected ? "default" : "secondary"
          return <Badge variant={variant}>{label}</Badge>
        },
      },
      {
        accessorKey: "reason",
        header: "Reason",
        cell: ({ row }) => row.original.reason ?? "—",
      },
    ],
    []
  )

  const table = useReactTable({
    data,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  return (
    <div
      className={
        paginationDocked ? "flex h-full flex-col gap-4" : "space-y-4"
      }
    >
      <div className="overflow-hidden rounded-2xl border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getPaginationRowModel().rows.length ? (
            table.getPaginationRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.original.selected ? "selected" : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                No results.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      </div>
      {shouldShowPagination ? (
        <div
          className={[
            "flex flex-wrap items-center justify-between gap-3 text-sm",
            paginationDocked ? "mt-auto" : null,
            paginationSticky
              ? "sticky bottom-0 bg-card/95 backdrop-blur border-t border-border px-3 py-2"
              : null,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <span className="text-muted-foreground">
            Showing{" "}
            {data.length === 0
              ? 0
              : pagination.pageIndex * pagination.pageSize + 1}
            –
            {Math.min(
              data.length,
              (pagination.pageIndex + 1) * pagination.pageSize
            )}{" "}
            of {data.length}
          </span>
          <Pagination className="mx-0 w-auto justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  onClick={(event) => {
                    event.preventDefault()
                    if (!table.getCanPreviousPage()) return
                    table.previousPage()
                  }}
                  className={
                    table.getCanPreviousPage()
                      ? undefined
                      : "pointer-events-none opacity-50"
                  }
                />
              </PaginationItem>
              {pageItems.map((item, index) =>
                item === "ellipsis" ? (
                  <PaginationItem key={`ellipsis-${index}`}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={`page-${item}`}>
                    <PaginationLink
                      href="#"
                      isActive={item === pagination.pageIndex}
                      onClick={(event) => {
                        event.preventDefault()
                        table.setPageIndex(item)
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
                    if (!table.getCanNextPage()) return
                    table.nextPage()
                  }}
                  className={
                    table.getCanNextPage()
                      ? undefined
                      : "pointer-events-none opacity-50"
                  }
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      ) : null}
    </div>
  )
}

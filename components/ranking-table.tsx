"use client"

import * as React from "react"
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type SortingFn,
} from "@tanstack/react-table"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
}

const scoreSort: SortingFn<LeadResult> = (rowA, rowB) => {
  const a = rowA.original.score ?? -1
  const b = rowB.original.score ?? -1
  return a === b ? 0 : a > b ? 1 : -1
}

export function RankingTable({ leads }: RankingTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "score", desc: true },
  ])

  const data = React.useMemo(() => leads, [leads])

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
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
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
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
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
  )
}

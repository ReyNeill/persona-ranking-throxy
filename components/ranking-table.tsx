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

function normalizeExternalUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
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
    pageSize: 10,
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
          const email = lead.email?.trim() || null
          const linkedinUrl = lead.linkedinUrl
            ? normalizeExternalUrl(lead.linkedinUrl)
            : null
          const contactLinks = [
            email
              ? { label: email, href: `mailto:${email}` }
              : null,
            linkedinUrl
              ? { label: "LinkedIn profile", href: linkedinUrl }
              : null,
          ].filter(Boolean) as Array<{ label: string; href: string }>
          const primaryHref = linkedinUrl ?? (email ? `mailto:${email}` : null)
          return (
            <div className="min-w-0 space-y-1">
              {primaryHref ? (
                <a
                  href={primaryHref}
                  target={linkedinUrl ? "_blank" : undefined}
                  rel={linkedinUrl ? "noreferrer" : undefined}
                  className="font-medium line-clamp-1 hover:underline"
                >
                  {lead.fullName ?? "Unknown"}
                </a>
              ) : (
                <div className="font-medium line-clamp-1">
                  {lead.fullName ?? "Unknown"}
                </div>
              )}
              <div className="text-muted-foreground text-xs line-clamp-1">
                {contactLinks.length ? (
                  contactLinks.map((contact, index) => (
                    <React.Fragment key={contact.href}>
                      {index > 0 ? (
                        <span className="px-1 text-muted-foreground">•</span>
                      ) : null}
                      <a
                        href={contact.href}
                        target={
                          contact.href.startsWith("http") ? "_blank" : undefined
                        }
                        rel={
                          contact.href.startsWith("http")
                            ? "noreferrer"
                            : undefined
                        }
                        className="hover:underline"
                      >
                        {contact.label}
                      </a>
                    </React.Fragment>
                  ))
                ) : (
                  "No contact"
                )}
              </div>
            </div>
          )
        },
      },
      {
        accessorKey: "title",
        header: "Title",
        cell: ({ row }) => (
          <span className="line-clamp-2">
            {row.original.title ?? "Unknown"}
          </span>
        ),
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
        cell: ({ row }) => (
          <span className="text-muted-foreground line-clamp-2">
            {row.original.reason ?? "—"}
          </span>
        ),
      },
    ],
    []
  )

  // eslint-disable-next-line react-hooks/incompatible-library
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
        <Table className="table-fixed text-xs [&_td]:align-top [&_td]:py-2 [&_th]:whitespace-nowrap">
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
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
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

"use client"

import * as React from "react"

import { RankingTable } from "@/components/ranking-table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { CompanyResult, RankingResponse } from "@/components/ranking-types"

type CompanyDialogProps = {
  company: CompanyResult | null
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  results: RankingResponse | null
}

export function CompanyDialog({
  company,
  isOpen,
  onOpenChange,
  results,
}: CompanyDialogProps) {
  const [selectedCompany, setSelectedCompany] = React.useState<CompanyResult | null>(company)

  // Keep selected company in sync with results
  React.useEffect(() => {
    if (!selectedCompany?.companyId) return
    const updated = results?.companies?.find(
      (c) => c.companyId === selectedCompany.companyId
    )
    if (updated && updated !== selectedCompany) {
      setSelectedCompany(updated)
    }
  }, [results?.companies, selectedCompany?.companyId, selectedCompany])

  // Sync with external company prop
  React.useEffect(() => {
    setSelectedCompany(company)
  }, [company])

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        onOpenChange(open)
        if (!open) {
          setSelectedCompany(null)
        }
      }}
    >
      <DialogContent className="bg-card text-card-foreground max-w-[calc(100%-2rem)] w-[95vw] h-[85vh] overflow-hidden text-sm sm:max-w-6xl sm:w-[95vw]">
        {selectedCompany ? (
          <div className="flex h-full flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{selectedCompany.companyName}</DialogTitle>
              <DialogDescription>
                {selectedCompany.leads.filter((lead) => lead.selected).length} selected out of{" "}
                {selectedCompany.leads.length} leads.
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <RankingTable
                leads={selectedCompany.leads}
                paginationMode="always"
                paginationSticky
                paginationDocked
              />
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}


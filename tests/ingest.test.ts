import { describe, expect, it } from "bun:test"

import { ingestCsvText } from "../lib/ingest"

type SupabaseStub = {
  calls: {
    ingestions: Array<Record<string, unknown>>
    companyUpserts: Array<Record<string, unknown>>
    leadInserts: Array<Record<string, unknown>>
  }
  from: (table: string) => any
}

function createSupabaseStub(): SupabaseStub {
  const calls = {
    ingestions: [],
    companyUpserts: [],
    leadInserts: [],
  }
  const companyIds = new Map<string, string>()
  let companyCounter = 1

  return {
    calls,
    from(table: string) {
      if (table === "lead_ingestions") {
        return {
          insert: (payload: Record<string, unknown>) => {
            calls.ingestions.push(payload)
            return {
              select: () => ({
                single: async () => ({
                  data: { id: "ingestion-1", ...payload },
                  error: null,
                }),
              }),
            }
          },
        }
      }

      if (table === "companies") {
        return {
          upsert: (payload: Record<string, unknown>) => {
            calls.companyUpserts.push(payload)
            const key = String(payload.name_normalized ?? payload.name ?? "")
            let companyId = companyIds.get(key)
            if (!companyId) {
              companyId = `company-${companyCounter}`
              companyCounter += 1
              companyIds.set(key, companyId)
            }
            return {
              select: () => ({
                single: async () => ({
                  data: { id: companyId, ...payload },
                  error: null,
                }),
              }),
            }
          },
        }
      }

      if (table === "leads") {
        return {
          insert: async (payload: Array<Record<string, unknown>>) => {
            calls.leadInserts.push(...payload)
            return { error: null }
          },
        }
      }

      throw new Error(`Unhandled table: ${table}`)
    },
  }
}

describe("ingestCsvText", () => {
  it("ingests leads, dedupes companies, and builds names", async () => {
    const csvText = [
      "Company Name,First Name,Last Name,Title,Email,LinkedIn URL",
      "Acme,Jane,Doe,VP,jane@acme.com,https://linkedin.com/in/jane",
      "Acme,,Smith,Engineer,,",
      ",No,Company,Intern,,",
      "Beta Inc,John,,Sales,,",
    ].join("\n")

    const supabase = createSupabaseStub()

    const result = await ingestCsvText({
      supabase: supabase as any,
      csvText,
      filename: "leads.csv",
    })

    expect(result).toEqual({
      ingestionId: "ingestion-1",
      leadCount: 3,
      skippedCount: 1,
      companyCount: 2,
    })

    expect(supabase.calls.companyUpserts.length).toBe(2)
    expect(supabase.calls.leadInserts.length).toBe(3)

    const jane = supabase.calls.leadInserts.find(
      (lead) => lead.full_name === "Jane Doe"
    )
    expect(jane?.title).toBe("VP")
    expect(jane?.email).toBe("jane@acme.com")

    const smith = supabase.calls.leadInserts.find(
      (lead) => lead.full_name === "Smith"
    )
    expect(smith?.title).toBe("Engineer")

    const companyIds = supabase.calls.leadInserts.map(
      (lead) => lead.company_id
    )
    const acmeCompanyIds = companyIds.filter((id) => id === "company-1")
    expect(acmeCompanyIds.length).toBe(2)
  })
})

import { describe, expect, it } from "bun:test"

import { ingestCsvText } from "@/lib/ingest"

type SupabaseStubOptions = {
  ingestionError?: string
  companyError?: string
  leadInsertError?: string
}

type SupabaseStubState = {
  ingestions: Array<Record<string, unknown>>
  companies: Map<string, { id: string; payload: Record<string, unknown> }>
  leads: Array<Record<string, unknown>>
  lastCompanyId: number
}

function createSupabaseStub(options: SupabaseStubOptions = {}) {
  const state: SupabaseStubState = {
    ingestions: [],
    companies: new Map(),
    leads: [],
    lastCompanyId: 0,
  }

  const supabase = {
    state,
    from(table: string) {
      if (table === "lead_ingestions") {
        return {
          insert(payload: Record<string, unknown>) {
            state.ingestions.push(payload)
            return {
              select() {
                return {
                  single() {
                    if (options.ingestionError) {
                      return {
                        data: null,
                        error: { message: options.ingestionError },
                      }
                    }
                    return { data: { id: "ingestion-1" }, error: null }
                  },
                }
              },
            }
          },
        }
      }

      if (table === "companies") {
        return {
          upsert(payload: Record<string, unknown>) {
            const key = String(payload.name_normalized)
            let company = state.companies.get(key)
            if (!company) {
              state.lastCompanyId += 1
              company = { id: `company-${state.lastCompanyId}`, payload }
              state.companies.set(key, company)
            }
            return {
              select() {
                return {
                  single() {
                    if (options.companyError) {
                      return {
                        data: null,
                        error: { message: options.companyError },
                      }
                    }
                    return { data: { id: company?.id }, error: null }
                  },
                }
              },
            }
          },
        }
      }

      if (table === "leads") {
        return {
          insert(batch: Array<Record<string, unknown>>) {
            if (options.leadInsertError) {
              return { error: { message: options.leadInsertError } }
            }
            state.leads.push(...batch)
            return { error: null }
          },
        }
      }

      throw new Error(`Unhandled table: ${table}`)
    },
  }

  return supabase
}

describe("ingestCsvText", () => {
  it("ingests csv rows and counts leads/companies", async () => {
    const csvText = [
      "company,first name,last name,title,email,linkedin",
      "Acme,Jane,Doe,VP Sales,jane@acme.com,https://li/jane",
      ",Missing,NoCo,CTO,missing@none.com,",
      "Acme,John,Smith,,john@acme.com,",
      "Beta Corp,,Lee,CEO,lee@beta.com,https://li/lee",
    ].join("\n")

    const supabase = createSupabaseStub()

    const result = await ingestCsvText({
      supabase: supabase as unknown as Parameters<typeof ingestCsvText>[0]["supabase"],
      csvText,
      filename: "leads.csv",
      source: "csv",
    })

    expect(result).toEqual({
      ingestionId: "ingestion-1",
      leadCount: 3,
      skippedCount: 1,
      companyCount: 2,
    })

    expect(supabase.state.leads).toHaveLength(3)
    expect(supabase.state.companies.size).toBe(2)

    const [first, second, third] = supabase.state.leads
    expect(first.full_name).toBe("Jane Doe")
    expect(second.full_name).toBe("John Smith")
    expect(third.full_name).toBe("Lee")
  })

  it("throws when ingestion insert fails", async () => {
    const supabase = createSupabaseStub({ ingestionError: "nope" })

    await expect(
      ingestCsvText({
        supabase: supabase as unknown as Parameters<typeof ingestCsvText>[0]["supabase"],
        csvText: "company\nAcme",
      })
    ).rejects.toThrow("nope")
  })
})

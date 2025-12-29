import { beforeEach, describe, expect, it, mock } from "bun:test"

type Lead = {
  id: string
  full_name: string | null
  title: string | null
  email: string | null
  linkedin_url: string | null
  data?: Record<string, unknown> | null
  company_id: string
  company: {
    id: string
    name: string
  }
  ingestion_id?: string | null
}

type GenerateTextOptions = {
  model: unknown
  prompt: string
  responseFormat?: unknown
  providerOptions?: unknown
}

type GenerateTextResult = {
  text: string
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
  providerMetadata?: Record<string, unknown>
  response?: { modelId?: string }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase mock requires flexible return types
type SupabaseTableHandler = any

type SupabaseRankingStub = {
  calls: {
    personas: Array<Record<string, unknown>>
    rankingRuns: Array<Record<string, unknown>>
    aiCalls: Array<Record<string, unknown>>
    leadRankings: Array<Record<string, unknown>>
    updates: Array<Record<string, unknown>>
  }
  from: (table: string) => SupabaseTableHandler
}

let supabaseStub: SupabaseRankingStub | null = null
let openrouterModel: Record<string, unknown> | null = null
let generateTextImpl: ((options: GenerateTextOptions) => Promise<GenerateTextResult>) | null = null

mock.module("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => {
    if (!supabaseStub) throw new Error("Supabase stub not set")
    return supabaseStub
  },
  createSupabaseServerClientOptional: () => supabaseStub,
}))

mock.module("@/lib/ai/openrouter", () => ({
  getOpenRouterModel: () => openrouterModel,
}))

mock.module("ai", () => ({
  generateText: async (options: GenerateTextOptions) => {
    if (!generateTextImpl) throw new Error("generateText not configured")
    return generateTextImpl(options)
  },
  wrapLanguageModel: ({ model }: { model: unknown }) => model,
}))

process.env.AI_DEVTOOLS = "false"

const { runRanking, getRankingResults } = await import("../lib/ranking")

function createSupabaseStub({
  leads,
  prompt,
}: {
  leads: Lead[]
  prompt: string | null
}): SupabaseRankingStub {
  const calls: SupabaseRankingStub["calls"] = {
    personas: [],
    rankingRuns: [],
    aiCalls: [],
    leadRankings: [],
    updates: [],
  }

  return {
    calls,
    from(table: string) {
      if (table === "personas") {
        return {
          insert: (payload: Record<string, unknown>) => {
            calls.personas.push(payload)
            return {
              select: () => ({
                single: async () => ({
                  data: {
                    id: "persona-1",
                    created_at: "2025-12-26T00:00:00Z",
                    ...payload,
                  },
                  error: null,
                }),
              }),
            }
          },
        }
      }

      if (table === "ranking_runs") {
        return {
          insert: (payload: Record<string, unknown>) => {
            calls.rankingRuns.push(payload)
            return {
              select: () => ({
                single: async () => ({
                  data: {
                    id: "run-1",
                    created_at: "2025-12-26T00:00:00Z",
                    ...payload,
                  },
                  error: null,
                }),
              }),
            }
          },
          update: (payload: Record<string, unknown>) => ({
            eq: async (column: string, value: string) => {
              calls.updates.push({ payload, column, value })
              return { error: null }
            },
          }),
        }
      }

      if (table === "leads") {
        type LeadsQueryChain = {
          select: () => LeadsQueryChain
          eq: (column: string, value: string) => Promise<{ data: Lead[]; error: null }>
          then: <T>(
            resolve: (value: { data: Lead[]; error: null }) => T,
            reject: (error: unknown) => T
          ) => Promise<T>
        }
        const query: LeadsQueryChain = {
          select: () => query,
          eq: async (_column: string, value: string) => ({
            data: leads.filter((lead) => lead.ingestion_id === value),
            error: null,
          }),
          then: (resolve, reject) =>
            Promise.resolve({ data: leads, error: null }).then(resolve, reject),
        }
        return query
      }

      if (table === "prompt_settings") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { persona_query_prompt: prompt, ranking_prompt: null },
                error: null,
              }),
            }),
          }),
        }
      }

      if (table === "prompt_leaderboards") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: null,
                error: { message: "Not found" },
              }),
            }),
          }),
        }
      }

      if (table === "ai_calls") {
        return {
          insert: async (payload: Record<string, unknown>) => {
            calls.aiCalls.push(payload)
            return { error: null }
          },
        }
      }

      if (table === "lead_rankings") {
        return {
          insert: async (payload: Array<Record<string, unknown>>) => {
            calls.leadRankings.push(...payload)
            return { error: null }
          },
        }
      }

      throw new Error(`Unhandled table: ${table}`)
    },
  }
}

beforeEach(() => {
  supabaseStub = null
  openrouterModel = null
  generateTextImpl = null
})

describe("runRanking", () => {
  it("ranks leads per company and records AI calls", async () => {
    const leads: Lead[] = [
      {
        id: "lead-1",
        full_name: "Alex",
        title: "VP Finance",
        email: "alex@acme.com",
        linkedin_url: null,
        data: { "employee range": "50-100" },
        company_id: "company-1",
        company: { id: "company-1", name: "Acme" },
      },
      {
        id: "lead-2",
        full_name: "Blair",
        title: "Engineer",
        email: null,
        linkedin_url: null,
        data: null,
        company_id: "company-1",
        company: { id: "company-1", name: "Acme" },
      },
      {
        id: "lead-3",
        full_name: "Casey",
        title: "CFO",
        email: "casey@beta.com",
        linkedin_url: null,
        data: null,
        company_id: "company-2",
        company: { id: "company-2", name: "Beta" },
      },
    ]

    supabaseStub = createSupabaseStub({ leads, prompt: "Summarize persona" })
    openrouterModel = { modelId: "openrouter" }

    let rankCall = 0
    generateTextImpl = async ({ prompt }) => {
      if (prompt.includes("Leads:")) {
        rankCall += 1
        if (rankCall === 1) {
          return {
            text: JSON.stringify([
              { index: 0, score: 0.9 },
              { index: 1, score: 0.3 },
            ]),
            usage: { inputTokens: 120, outputTokens: 40, totalTokens: 160 },
            providerMetadata: { openrouter: { usage: { cost: 0.004 } } },
            response: { modelId: "openai/gpt-oss-120b" },
          }
        }
        return {
          text: JSON.stringify([{ index: 0, score: 0.6 }]),
          usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
          providerMetadata: { openrouter: { usage: { cost: 0.002 } } },
          response: { modelId: "openai/gpt-oss-120b" },
        }
      }

      return {
        text: "AI query",
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        providerMetadata: { openrouter: { usage: { cost: 0.002 } } },
        response: { modelId: "openai/gpt-4o-mini" },
      }
    }

    const result = await runRanking({
      personaSpec: "Target CFO",
      topN: 1,
      minScore: 0.5,
      ingestionId: null,
    })

    expect(result.runId).toBe("run-1")
    expect(result.companies.length).toBe(2)

    const acme = result.companies.find((company) => company.companyId === "company-1")
    expect(acme?.leads[0]?.selected).toBe(true)
    expect(acme?.leads[1]?.selected).toBe(false)

    const beta = result.companies.find((company) => company.companyId === "company-2")
    expect(beta?.leads[0]?.selected).toBe(true)

    expect(supabaseStub.calls.leadRankings.length).toBe(3)
    expect(supabaseStub.calls.aiCalls.length).toBe(5)
  })
})

describe("getRankingResults", () => {
  it("groups results by company and normalizes relations", async () => {
    const rows = [
      {
        score: 0.9,
        relevance: "relevant",
        rank: 1,
        selected: true,
        reason: "Matched persona criteria based on title and company context.",
        lead: [
          {
            id: "lead-1",
            full_name: "Alex",
            title: "VP Finance",
            email: "alex@acme.com",
            linkedin_url: null,
          },
        ],
        company: {
          id: "company-1",
          name: "Acme",
        },
      },
      {
        score: 0.4,
        relevance: "irrelevant",
        rank: 2,
        selected: false,
        reason: "Below relevance threshold for this persona.",
        lead: {
          id: "lead-2",
          full_name: "Blair",
          title: "Engineer",
          email: null,
          linkedin_url: null,
        },
        company: [{ id: "company-1", name: "Acme" }],
      },
    ]

    supabaseStub = {
      calls: {
        personas: [],
        rankingRuns: [],
        aiCalls: [],
        leadRankings: [],
        updates: [],
      },
      from(table: string) {
        if (table === "ranking_runs") {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: "run-1",
                    created_at: "2025-12-26T00:00:00Z",
                    top_n: 2,
                    min_score: 0.4,
                  },
                  error: null,
                }),
              }),
            }),
          }
        }

        if (table === "lead_rankings") {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  order: async () => ({
                    data: rows,
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }

        throw new Error(`Unhandled table: ${table}`)
      },
    }

    const results = await getRankingResults("run-1")

    expect(results?.companies.length).toBe(1)
    const company = results?.companies[0]
    expect(company?.companyId).toBe("company-1")
    expect(company?.leads.length).toBe(2)
    expect(company?.leads[0]?.leadId).toBe("lead-1")
  })

  it("returns null when no supabase client is available", async () => {
    supabaseStub = null
    const results = await getRankingResults("run-1")
    expect(results).toBeNull()
  })
})

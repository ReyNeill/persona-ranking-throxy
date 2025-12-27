import { beforeEach, describe, expect, it } from "bun:test"

import { handleRankStreamRequest } from "../app/api/rank/stream/route"

import type { runRanking } from "../lib/ranking"

type RunRankingFn = typeof runRanking
type RankingInput = Parameters<RunRankingFn>[0]
type RankingResult = Awaited<ReturnType<RunRankingFn>>

let runRankingImpl: RunRankingFn | null = null
let lastRunRankingInput: RankingInput | null = null

const baseRankingResult = {
  runId: "ignored",
  createdAt: "2025-12-26T00:00:00Z",
  topN: 1,
  minScore: 0,
  personaSpec: null,
  companies: [],
}

beforeEach(() => {
  runRankingImpl = null
  lastRunRankingInput = null
})

describe("/api/rank/stream", () => {
  it("rejects missing personaSpec", async () => {
    const request = new Request("http://localhost/api/rank/stream", {
      method: "POST",
      body: JSON.stringify({ topN: 2 }),
      headers: { "Content-Type": "application/json" },
    })

    const response = await handleRankStreamRequest(request, {
      runRanking: async () => ({ ...baseRankingResult }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "personaSpec is required",
    })
  })

  it("streams progress events and clamps inputs", async () => {
    runRankingImpl = async (input, options): Promise<RankingResult> => {
      lastRunRankingInput = input
      await options?.onProgress?.({ type: "start", runId: "run-1", totalCompanies: 2 })
      await options?.onProgress?.({ type: "complete", runId: "run-1", completed: 2, total: 2 })
      return { ...baseRankingResult, runId: "run-1", companies: [] }
    }

    const request = new Request("http://localhost/api/rank/stream", {
      method: "POST",
      body: JSON.stringify({
        personaSpec: " Target CFO ",
        topN: 99,
        minScore: -2,
      }),
      headers: { "Content-Type": "application/json" },
    })

    const response = await handleRankStreamRequest(request, {
      runRanking: async (input, options) => {
        if (!runRankingImpl) throw new Error("runRanking not configured")
        return runRankingImpl(input, options)
      },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("text/event-stream")
    expect(lastRunRankingInput).toEqual({
      personaSpec: "Target CFO",
      topN: 25,
      minScore: 0,
      ingestionId: null,
    })

    const text = await response.text()
    expect(text).toContain("data: {\"type\":\"start\"")
    expect(text).toContain("data: {\"type\":\"complete\"")
  })

  it("streams error events when ranking fails", async () => {
    runRankingImpl = async (): Promise<RankingResult> => {
      throw new Error("boom")
    }

    const request = new Request("http://localhost/api/rank/stream", {
      method: "POST",
      body: JSON.stringify({ personaSpec: "Target" }),
      headers: { "Content-Type": "application/json" },
    })

    const response = await handleRankStreamRequest(request, {
      runRanking: async (input, options) => {
        if (!runRankingImpl) throw new Error("runRanking not configured")
        return runRankingImpl(input, options)
      },
    })

    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain("data: {\"type\":\"error\",\"message\":\"boom\"}")
  })
})

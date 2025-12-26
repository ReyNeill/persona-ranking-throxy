import { beforeEach, describe, expect, it } from "bun:test"

import { handleRankStreamRequest } from "../app/api/rank/stream/route"

let runRankingImpl: ((input: any, options?: any) => Promise<any>) | null = null
let lastRunRankingInput: any = null

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
      runRanking: async () => ({ runId: "ignored" }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "personaSpec is required",
    })
  })

  it("streams progress events and clamps inputs", async () => {
    runRankingImpl = async (input, options) => {
      lastRunRankingInput = input
      await options?.onProgress?.({ type: "start", runId: "run-1", totalCompanies: 2 })
      await options?.onProgress?.({ type: "complete", runId: "run-1", completed: 2, total: 2 })
      return { runId: "run-1" }
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
    runRankingImpl = async () => {
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

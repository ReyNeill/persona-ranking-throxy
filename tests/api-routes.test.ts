import { beforeEach, describe, expect, it } from "bun:test"

import { handleRankRequest } from "../app/api/rank/route"
import { handleResultsRequest } from "../app/api/results/route"

let runRankingImpl: ((input: any) => Promise<any>) | null = null
let getRankingResultsImpl: ((runId?: string | null) => Promise<any>) | null = null
let lastRunRankingInput: any = null

beforeEach(() => {
  runRankingImpl = null
  getRankingResultsImpl = null
  lastRunRankingInput = null
})

describe("/api/rank", () => {
  it("rejects missing personaSpec", async () => {
    const request = new Request("http://localhost/api/rank", {
      method: "POST",
      body: JSON.stringify({ topN: 2 }),
      headers: { "Content-Type": "application/json" },
    })

    const response = await handleRankRequest(request, {
      runRanking: async () => ({ runId: "ignored", companies: [] }),
    })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "personaSpec is required",
    })
  })

  it("rejects empty personaSpec", async () => {
    const request = new Request("http://localhost/api/rank", {
      method: "POST",
      body: JSON.stringify({ personaSpec: "  " }),
      headers: { "Content-Type": "application/json" },
    })

    const response = await handleRankRequest(request, {
      runRanking: async () => ({ runId: "ignored", companies: [] }),
    })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "personaSpec is required",
    })
  })

  it("runs ranking with clamped values", async () => {
    runRankingImpl = async () => ({ runId: "run-1", companies: [] })

    const request = new Request("http://localhost/api/rank", {
      method: "POST",
      body: JSON.stringify({
        personaSpec: " Target CFO ",
        topN: 50,
        minScore: -1,
        ingestionId: "ing-1",
      }),
      headers: { "Content-Type": "application/json" },
    })

    const response = await handleRankRequest(request, {
      runRanking: async (input) => {
        lastRunRankingInput = input
        if (!runRankingImpl) throw new Error("runRanking not configured")
        return runRankingImpl(input)
      },
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      runId: "run-1",
      companies: [],
    })

    expect(lastRunRankingInput).toEqual({
      personaSpec: "Target CFO",
      topN: 25,
      minScore: 0,
      ingestionId: "ing-1",
    })
  })

  it("returns 500 on ranking errors", async () => {
    runRankingImpl = async () => {
      throw new Error("boom")
    }

    const request = new Request("http://localhost/api/rank", {
      method: "POST",
      body: JSON.stringify({ personaSpec: "Target" }),
      headers: { "Content-Type": "application/json" },
    })

    const response = await handleRankRequest(request, {
      runRanking: async (input) => {
        lastRunRankingInput = input
        if (!runRankingImpl) throw new Error("runRanking not configured")
        return runRankingImpl(input)
      },
    })
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: "boom" })
  })
})

describe("/api/results", () => {
  it("returns empty payload when no results are available", async () => {
    getRankingResultsImpl = async () => null

    const request = new Request("http://localhost/api/results", {
      method: "GET",
    })

    const response = await handleResultsRequest(request, {
      getRankingResults: async (runId) => {
        if (!getRankingResultsImpl)
          throw new Error("getRankingResults not configured")
        return getRankingResultsImpl(runId)
      },
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      runId: null,
      companies: [],
    })
  })

  it("returns ranking results from the service", async () => {
    getRankingResultsImpl = async (runId) => ({
      runId,
      createdAt: "2025-12-26T00:00:00Z",
      topN: 2,
      minScore: 0.4,
      personaSpec: null,
      companies: [{ companyId: "company-1", companyName: "Acme", leads: [] }],
    })

    const request = new Request("http://localhost/api/results?runId=run-1", {
      method: "GET",
    })

    const response = await handleResultsRequest(request, {
      getRankingResults: async (runId) => {
        if (!getRankingResultsImpl)
          throw new Error("getRankingResults not configured")
        return getRankingResultsImpl(runId)
      },
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      runId: "run-1",
      createdAt: "2025-12-26T00:00:00Z",
      topN: 2,
      minScore: 0.4,
      personaSpec: null,
      companies: [{ companyId: "company-1", companyName: "Acme", leads: [] }],
    })
  })

  it("returns 500 on result errors", async () => {
    getRankingResultsImpl = async () => {
      throw new Error("failed")
    }

    const request = new Request("http://localhost/api/results", {
      method: "GET",
    })

    const response = await handleResultsRequest(request, {
      getRankingResults: async (runId) => {
        if (!getRankingResultsImpl)
          throw new Error("getRankingResults not configured")
        return getRankingResultsImpl(runId)
      },
    })
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: "failed" })
  })
})

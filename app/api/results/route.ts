import { NextResponse } from "next/server"

import { getRankingResults } from "@/lib/ranking"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const runId = searchParams.get("runId")

  try {
    const result = await getRankingResults(runId)
    if (!result) {
      return NextResponse.json({ runId: null, companies: [] })
    }
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

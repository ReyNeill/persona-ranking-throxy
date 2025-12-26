import { NextResponse } from "next/server"

import { runRanking } from "@/lib/ranking"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)

  if (!body?.personaSpec || typeof body.personaSpec !== "string") {
    return NextResponse.json(
      { error: "personaSpec is required" },
      { status: 400 }
    )
  }

  const trimmedSpec = body.personaSpec.trim()
  if (!trimmedSpec) {
    return NextResponse.json(
      { error: "personaSpec is required" },
      { status: 400 }
    )
  }

  const topNValue = Number(body.topN)
  const minScoreValue = Number(body.minScore)
  const topN = Number.isFinite(topNValue) ? topNValue : 3
  const minScore = Number.isFinite(minScoreValue) ? minScoreValue : 0.4

  try {
    const result = await runRanking({
      personaSpec: trimmedSpec,
      topN: Math.max(1, Math.min(topN, 25)),
      minScore: Math.max(0, Math.min(minScore, 1)),
      ingestionId: body.ingestionId ?? null,
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

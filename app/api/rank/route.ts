import { NextResponse } from "next/server"

import { RANKING_CONFIG } from "@/lib/constants"
import { runRanking } from "@/lib/ranking"

export const runtime = "nodejs"

type RunRankingFn = typeof runRanking

export async function handleRankRequest(
  request: Request,
  deps: { runRanking: RunRankingFn } = { runRanking }
) {
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
  const topN = Number.isFinite(topNValue) ? topNValue : RANKING_CONFIG.DEFAULT_TOP_N
  const minScore = Number.isFinite(minScoreValue)
    ? minScoreValue
    : RANKING_CONFIG.DEFAULT_MIN_SCORE

  try {
    const result = await deps.runRanking({
      personaSpec: trimmedSpec,
      topN: Math.max(
        RANKING_CONFIG.MIN_TOP_N,
        Math.min(topN, RANKING_CONFIG.MAX_TOP_N)
      ),
      minScore: Math.max(
        RANKING_CONFIG.MIN_SCORE,
        Math.min(minScore, RANKING_CONFIG.MAX_SCORE)
      ),
      ingestionId: body.ingestionId ?? null,
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return handleRankRequest(request)
}

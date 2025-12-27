import { RANKING_CONFIG } from "@/lib/constants"
import { runRanking } from "@/lib/ranking"

export const runtime = "nodejs"

type RunRankingFn = typeof runRanking

export async function handleRankStreamRequest(
  request: Request,
  deps: { runRanking: RunRankingFn } = { runRanking }
) {
  const body = await request.json().catch(() => null)

  if (!body?.personaSpec || typeof body.personaSpec !== "string") {
    return new Response(
      JSON.stringify({ error: "personaSpec is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    )
  }

  const trimmedSpec = body.personaSpec.trim()
  if (!trimmedSpec) {
    return new Response(
      JSON.stringify({ error: "personaSpec is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    )
  }

  const topNValue = Number(body.topN)
  const minScoreValue = Number(body.minScore)
  const topN = Number.isFinite(topNValue)
    ? topNValue
    : RANKING_CONFIG.DEFAULT_TOP_N
  const minScore = Number.isFinite(minScoreValue)
    ? minScoreValue
    : RANKING_CONFIG.DEFAULT_MIN_SCORE

  const encoder = new TextEncoder()

  // AbortController to cancel the ranking operation if client disconnects
  const abortController = new AbortController()

  const stream = new ReadableStream({
    start(controller) {
      let closed = false

      const send = (payload: unknown) => {
        if (closed) return
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
        )
      }

      const handleAbort = () => {
        if (closed) return
        closed = true
        abortController.abort()
        try {
          controller.close()
        } catch {
          // Controller may already be closed
        }
      }

      if (request.signal.aborted) {
        handleAbort()
        return
      }

      request.signal.addEventListener("abort", handleAbort)

      deps.runRanking(
        {
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
        },
        {
          onProgress: async (event) => {
            // Check if aborted before sending each event
            if (abortController.signal.aborted) return
            send(event)
          },
          signal: abortController.signal,
        }
      )
        .then(() => {
          if (!closed) {
            closed = true
            controller.close()
          }
        })
        .catch((error) => {
          if (closed) return
          // Don't send error for abort
          if (error instanceof Error && error.name === "AbortError") {
            closed = true
            try {
              controller.close()
            } catch {
              // Already closed
            }
            return
          }
          const message = error instanceof Error ? error.message : "Unknown error"
          send({ type: "error", message })
          closed = true
          try {
            controller.close()
          } catch {
            // Already closed
          }
        })
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}

export async function POST(request: Request) {
  return handleRankStreamRequest(request)
}

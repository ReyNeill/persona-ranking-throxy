import { runRanking } from "@/lib/ranking"

export const runtime = "nodejs"

export async function POST(request: Request) {
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
  const topN = Number.isFinite(topNValue) ? topNValue : 3
  const minScore = Number.isFinite(minScoreValue) ? minScoreValue : 0.4

  const encoder = new TextEncoder()

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
        closed = true
        controller.close()
      }

      if (request.signal.aborted) {
        handleAbort()
        return
      }

      request.signal.addEventListener("abort", handleAbort)

      runRanking(
        {
          personaSpec: trimmedSpec,
          topN: Math.max(1, Math.min(topN, 25)),
          minScore: Math.max(0, Math.min(minScore, 1)),
          ingestionId: body.ingestionId ?? null,
        },
        {
          onProgress: async (event) => {
            send(event)
          },
        }
      )
        .then(() => {
          if (!closed) controller.close()
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : "Unknown error"
          send({ type: "error", message })
          if (!closed) controller.close()
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

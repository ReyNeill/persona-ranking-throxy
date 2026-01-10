import { NextResponse } from "next/server"
import { auth } from "@trigger.dev/sdk/v3"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { runId } = body

    if (!runId || typeof runId !== "string") {
      return NextResponse.json({ error: "runId is required" }, { status: 400 })
    }

    const publicToken = await auth.createPublicToken({
      scopes: {
        read: { runs: [runId] },
      },
    })

    return NextResponse.json({ token: publicToken })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

import { NextResponse } from "next/server"

import { ingestCsvText } from "@/lib/ingest"
import {
  checkRateLimit,
  getClientIdentifier,
  RATE_LIMITS,
} from "@/lib/rate-limit"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

export async function POST(request: Request) {
  // Apply rate limiting
  const clientId = getClientIdentifier(request)
  const rateLimitResult = await checkRateLimit(
    `ingest:${clientId}`,
    RATE_LIMITS.ingest
  )

  if (!rateLimitResult.success) {
    const retryAfter = Math.ceil(
      (rateLimitResult.resetTime - Date.now()) / 1000
    )
    return NextResponse.json(
      {
        error: "Too many upload requests. Please try again later.",
        retryAfter,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(rateLimitResult.limit),
          "X-RateLimit-Remaining": String(rateLimitResult.remaining),
          "X-RateLimit-Reset": String(rateLimitResult.resetTime),
        },
      }
    )
  }

  try {
    const formData = await request.formData()
    const file = formData.get("file")
    const notes = formData.get("notes")

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "CSV file is required" }, { status: 400 })
    }

    const csvText = await file.text()
    const supabase = createSupabaseServerClient()

    const result = await ingestCsvText({
      supabase,
      csvText,
      filename: file.name,
      source: "upload",
      notes: typeof notes === "string" ? notes : null,
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

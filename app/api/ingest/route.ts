import { NextResponse } from "next/server"
import { tasks } from "@trigger.dev/sdk/v3"

import { uploadCsvToStorage } from "@/lib/storage"
import {
  checkRateLimit,
  getClientIdentifier,
  RATE_LIMITS,
} from "@/lib/rate-limit"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import type { csvImportTask } from "@/trigger/csv-import"

export const runtime = "nodejs"

// Maximum file size: 100MB
const MAX_FILE_SIZE = 100 * 1024 * 1024

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
      return NextResponse.json(
        { error: "CSV file is required" },
        { status: 400 }
      )
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`,
        },
        { status: 400 }
      )
    }

    const supabase = createSupabaseServerClient()

    // 1. Create ingestion record with pending status
    const { data: ingestion, error: ingestionError } = await supabase
      .from("lead_ingestions")
      .insert({
        source: "upload",
        filename: file.name,
        notes: typeof notes === "string" ? notes : null,
        status: "uploading",
      })
      .select()
      .single()

    if (ingestionError || !ingestion) {
      throw new Error(
        ingestionError?.message ?? "Failed to create ingestion record"
      )
    }

    // 2. Upload CSV to Supabase Storage
    const storagePath = await uploadCsvToStorage(file, ingestion.id)

    // 3. Update ingestion with storage path
    await supabase
      .from("lead_ingestions")
      .update({ storage_path: storagePath, status: "pending" })
      .eq("id", ingestion.id)

    // 4. Trigger background task
    const handle = await tasks.trigger<typeof csvImportTask>("csv-import", {
      ingestionId: ingestion.id,
      storagePath,
      filename: file.name,
    })

    // 5. Store trigger run ID
    await supabase
      .from("lead_ingestions")
      .update({ trigger_run_id: handle.id })
      .eq("id", ingestion.id)

    // 6. Return immediately with IDs for polling
    return NextResponse.json({
      ingestionId: ingestion.id,
      runId: handle.id,
      status: "pending",
      message: "CSV upload started. Processing in background.",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

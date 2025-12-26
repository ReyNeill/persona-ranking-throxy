import { NextResponse } from "next/server"

import { ingestCsvText } from "@/lib/ingest"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

export async function POST(request: Request) {
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

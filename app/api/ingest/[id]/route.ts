import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params
  const supabase = createSupabaseServerClient()

  const { data: ingestion, error } = await supabase
    .from("lead_ingestions")
    .select("*")
    .eq("id", id)
    .single()

  if (error || !ingestion) {
    return NextResponse.json({ error: "Ingestion not found" }, { status: 404 })
  }

  return NextResponse.json({
    id: ingestion.id,
    status: ingestion.status,
    runId: ingestion.trigger_run_id,
    filename: ingestion.filename,
    totalRows: ingestion.total_rows,
    processedRows: ingestion.processed_rows,
    leadCount: ingestion.lead_count,
    companyCount: ingestion.company_count,
    skippedCount: ingestion.skipped_count,
    errorMessage: ingestion.error_message,
    createdAt: ingestion.created_at,
    startedAt: ingestion.started_at,
    completedAt: ingestion.completed_at,
  })
}

import { task, metadata } from "@trigger.dev/sdk/v3"
import { parse } from "csv-parse/sync"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

// Types
export type CsvImportPayload = {
  ingestionId: string
  storagePath: string
  filename: string
}

type ProgressMetadata = {
  status:
    | "initializing"
    | "downloading"
    | "counting"
    | "processing"
    | "finalizing"
    | "completed"
    | "failed"
  totalRows: number
  processedRows: number
  percentage: number
  currentPhase: string
  companiesProcessed: number
  leadsInserted: number
  skippedRows: number
}

type LeadRecord = Record<string, string>

// Create Supabase client for background task
function createTaskSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY

  if (!url || !key) {
    throw new Error("Missing Supabase environment variables")
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  })
}

// Field extraction helpers (extracted from lib/ingest.ts)
function normalizeRow(record: LeadRecord): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(record)) {
    normalized[key.toLowerCase().trim()] = value
  }
  return normalized
}

function pickField(
  row: Record<string, string>,
  candidates: string[]
): string | null {
  for (const key of candidates) {
    if (key in row && row[key]) return row[key]
  }
  return null
}

function buildCompanyName(row: Record<string, string>): string {
  return (
    pickField(row, [
      "company",
      "company name",
      "account",
      "account name",
      "account_name",
      "accountname",
    ])?.trim() ?? ""
  )
}

function buildLeadName(row: Record<string, string>): string | null {
  const firstName = pickField(row, [
    "first name",
    "first_name",
    "lead_first_name",
    "lead first name",
  ])
  const lastName = pickField(row, [
    "last name",
    "last_name",
    "lead_last_name",
    "lead last name",
  ])
  const fullName =
    pickField(row, [
      "name",
      "full name",
      "full_name",
      "contact",
      "person",
    ])?.trim() ?? [firstName, lastName].filter(Boolean).join(" ").trim()

  return fullName || null
}

// Progress update helper
function updateProgress(progress: ProgressMetadata): void {
  metadata.set("progress", progress)
}

// Batch processing
async function processCSVInBatches(
  supabase: SupabaseClient,
  csvText: string,
  ingestionId: string,
  totalRows: number
): Promise<{
  processedRows: number
  leadCount: number
  companyCount: number
  skippedCount: number
}> {
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as LeadRecord[]

  const companyCache = new Map<string, string>()
  const pendingLeads: Array<Record<string, unknown>> = []

  let processedRows = 0
  let skipped = 0
  let leadCount = 0
  let companyCount = 0

  const COMPANY_BATCH_SIZE = 50
  const LEAD_BATCH_SIZE = 500
  const PROGRESS_UPDATE_INTERVAL = 100

  // First pass: collect unique companies
  const uniqueCompanies = new Map<string, string>()
  for (const record of records) {
    const normalized = normalizeRow(record)
    const companyName = buildCompanyName(normalized)
    if (companyName) {
      const key = companyName.toLowerCase()
      if (!uniqueCompanies.has(key)) {
        uniqueCompanies.set(key, companyName)
      }
    }
  }

  // Batch upsert companies
  const companyEntries = Array.from(uniqueCompanies.entries())
  for (let i = 0; i < companyEntries.length; i += COMPANY_BATCH_SIZE) {
    const batch = companyEntries.slice(i, i + COMPANY_BATCH_SIZE)
    const companyData = batch.map(([key, name]) => ({
      name,
      name_normalized: key,
    }))

    const { data: companies, error } = await supabase
      .from("companies")
      .upsert(companyData, { onConflict: "name_normalized" })
      .select("id, name_normalized")

    if (error) {
      throw new Error(`Company upsert failed: ${error.message}`)
    }

    for (const company of companies ?? []) {
      companyCache.set(company.name_normalized, company.id)
    }

    companyCount = companyCache.size

    updateProgress({
      status: "processing",
      totalRows,
      processedRows: 0,
      percentage: Math.round((companyCache.size / uniqueCompanies.size) * 10),
      currentPhase: `Upserting companies (${companyCache.size}/${uniqueCompanies.size})`,
      companiesProcessed: companyCache.size,
      leadsInserted: 0,
      skippedRows: 0,
    })
  }

  // Second pass: process leads
  for (const record of records) {
    const normalized = normalizeRow(record)
    const companyName = buildCompanyName(normalized)

    if (!companyName) {
      skipped++
      processedRows++
      continue
    }

    const companyKey = companyName.toLowerCase()
    const companyId = companyCache.get(companyKey)

    if (!companyId) {
      skipped++
      processedRows++
      continue
    }

    const title = pickField(normalized, [
      "title",
      "job title",
      "position",
      "role",
      "lead_job_title",
      "lead job title",
    ])
    const email = pickField(normalized, ["email", "email address"])
    const linkedinUrl = pickField(normalized, [
      "linkedin",
      "linkedin url",
      "linkedin_url",
      "linkedin profile",
    ])

    pendingLeads.push({
      company_id: companyId,
      ingestion_id: ingestionId,
      full_name: buildLeadName(normalized),
      title: title || null,
      email: email || null,
      linkedin_url: linkedinUrl || null,
      data: record,
    })

    // Batch insert leads when we hit the batch size
    if (pendingLeads.length >= LEAD_BATCH_SIZE) {
      const { error } = await supabase.from("leads").insert(pendingLeads)
      if (error) {
        throw new Error(`Lead insert failed: ${error.message}`)
      }

      leadCount += pendingLeads.length
      pendingLeads.length = 0
    }

    processedRows++

    // Update progress periodically
    if (processedRows % PROGRESS_UPDATE_INTERVAL === 0) {
      const percentage = 10 + Math.round((processedRows / totalRows) * 90)
      updateProgress({
        status: "processing",
        totalRows,
        processedRows,
        percentage,
        currentPhase: `Processing leads (${processedRows.toLocaleString()}/${totalRows.toLocaleString()})`,
        companiesProcessed: companyCount,
        leadsInserted: leadCount,
        skippedRows: skipped,
      })
    }
  }

  // Insert remaining leads
  if (pendingLeads.length > 0) {
    const { error } = await supabase.from("leads").insert(pendingLeads)
    if (error) {
      throw new Error(`Lead insert failed: ${error.message}`)
    }
    leadCount += pendingLeads.length
  }

  return {
    processedRows,
    leadCount,
    companyCount,
    skippedCount: skipped,
  }
}

// Main task
export const csvImportTask = task({
  id: "csv-import",
  maxDuration: 600, // 10 minutes max
  retry: {
    maxAttempts: 2,
  },
  run: async (payload: CsvImportPayload) => {
    const supabase = createTaskSupabase()
    const { ingestionId, storagePath } = payload

    updateProgress({
      status: "initializing",
      totalRows: 0,
      processedRows: 0,
      percentage: 0,
      currentPhase: "Initializing...",
      companiesProcessed: 0,
      leadsInserted: 0,
      skippedRows: 0,
    })

    try {
      // Update ingestion status
      await supabase
        .from("lead_ingestions")
        .update({
          status: "processing",
          started_at: new Date().toISOString(),
        })
        .eq("id", ingestionId)

      // Download CSV from storage
      updateProgress({
        status: "downloading",
        totalRows: 0,
        processedRows: 0,
        percentage: 2,
        currentPhase: "Downloading CSV from storage...",
        companiesProcessed: 0,
        leadsInserted: 0,
        skippedRows: 0,
      })

      const { data: fileData, error: downloadError } = await supabase.storage
        .from("csv-uploads")
        .download(storagePath)

      if (downloadError || !fileData) {
        throw new Error(`Download failed: ${downloadError?.message}`)
      }

      const csvText = await fileData.text()

      // Count rows for progress tracking
      const lines = csvText.split("\n").filter((line) => line.trim())
      const totalRows = Math.max(0, lines.length - 1) // Subtract header

      updateProgress({
        status: "counting",
        totalRows,
        processedRows: 0,
        percentage: 5,
        currentPhase: `Found ${totalRows.toLocaleString()} rows to process`,
        companiesProcessed: 0,
        leadsInserted: 0,
        skippedRows: 0,
      })

      // Process CSV in batches
      const result = await processCSVInBatches(
        supabase,
        csvText,
        ingestionId,
        totalRows
      )

      // Update final status
      await supabase
        .from("lead_ingestions")
        .update({
          status: "completed",
          total_rows: totalRows,
          processed_rows: result.processedRows,
          lead_count: result.leadCount,
          company_count: result.companyCount,
          skipped_count: result.skippedCount,
          completed_at: new Date().toISOString(),
        })
        .eq("id", ingestionId)

      // Cleanup: delete CSV from storage
      await supabase.storage.from("csv-uploads").remove([storagePath])

      updateProgress({
        status: "completed",
        totalRows,
        processedRows: result.processedRows,
        percentage: 100,
        currentPhase: "Import complete!",
        companiesProcessed: result.companyCount,
        leadsInserted: result.leadCount,
        skippedRows: result.skippedCount,
      })

      return {
        success: true,
        ingestionId,
        leadCount: result.leadCount,
        companyCount: result.companyCount,
        skippedCount: result.skippedCount,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"

      await supabase
        .from("lead_ingestions")
        .update({
          status: "failed",
          error_message: message,
          completed_at: new Date().toISOString(),
        })
        .eq("id", ingestionId)

      updateProgress({
        status: "failed",
        totalRows: 0,
        processedRows: 0,
        percentage: 0,
        currentPhase: `Error: ${message}`,
        companiesProcessed: 0,
        leadsInserted: 0,
        skippedRows: 0,
      })

      throw error
    }
  },
})

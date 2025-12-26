import { parse } from "csv-parse/sync"
import type { SupabaseClient } from "@supabase/supabase-js"

type IngestCsvInput = {
  supabase: SupabaseClient
  csvText: string
  filename?: string | null
  source?: string | null
  notes?: string | null
}

type IngestCsvResult = {
  ingestionId: string
  leadCount: number
  skippedCount: number
  companyCount: number
}

type LeadRecord = Record<string, string>

function pickField(row: Record<string, string>, candidates: string[]) {
  for (const key of candidates) {
    if (key in row && row[key]) return row[key]
  }
  return null
}

function normalizeRow(record: LeadRecord) {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(record)) {
    normalized[key.toLowerCase().trim()] = value
  }
  return normalized
}

function buildCompanyName(row: Record<string, string>) {
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

function buildLeadName(row: Record<string, string>) {
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

export async function ingestCsvText({
  supabase,
  csvText,
  filename,
  source,
  notes,
}: IngestCsvInput): Promise<IngestCsvResult> {
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as LeadRecord[]

  const { data: ingestion, error: ingestionError } = await supabase
    .from("lead_ingestions")
    .insert({
      source: source ?? "csv",
      filename: filename ?? null,
      notes: notes ?? null,
    })
    .select()
    .single()

  if (ingestionError) {
    throw new Error(ingestionError.message)
  }

  const companyCache = new Map<string, string>()
  const leadsToInsert: Array<Record<string, unknown>> = []
  let skipped = 0

  for (const record of records) {
    const normalized = normalizeRow(record)
    const companyName = buildCompanyName(normalized)
    if (!companyName) {
      skipped += 1
      continue
    }

    const companyKey = companyName.toLowerCase()
    let companyId = companyCache.get(companyKey)

    if (!companyId) {
      const { data: company, error: companyError } = await supabase
        .from("companies")
        .upsert(
          {
            name: companyName,
            name_normalized: companyKey,
          },
          { onConflict: "name_normalized" }
        )
        .select()
        .single()

      if (companyError) {
        throw new Error(companyError.message)
      }

      const companyIdFromDb = company?.id
      if (!companyIdFromDb) {
        throw new Error("Missing company id after upsert")
      }

      companyId = companyIdFromDb
      companyCache.set(companyKey, companyIdFromDb)
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

    leadsToInsert.push({
      company_id: companyId,
      ingestion_id: ingestion.id,
      full_name: buildLeadName(normalized),
      title: title || null,
      email: email || null,
      linkedin_url: linkedinUrl || null,
      data: record,
    })
  }

  const batchSize = 500
  for (let i = 0; i < leadsToInsert.length; i += batchSize) {
    const batch = leadsToInsert.slice(i, i + batchSize)
    const { error } = await supabase.from("leads").insert(batch)
    if (error) {
      throw new Error(error.message)
    }
  }

  return {
    ingestionId: ingestion.id,
    leadCount: leadsToInsert.length,
    skippedCount: skipped,
    companyCount: companyCache.size,
  }
}

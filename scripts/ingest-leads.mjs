import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import dotenv from "dotenv"
import { parse } from "csv-parse/sync"
import { createClient } from "@supabase/supabase-js"

const envPath = fs.existsSync(".env.local") ? ".env.local" : ".env"
dotenv.config({ path: envPath })

function getArgValue(flag) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

const filePath = getArgValue("--file") ?? process.argv[2]

if (!filePath) {
  console.error("Usage: npm run ingest:leads -- --file path/to/leads.csv")
  process.exit(1)
}

const supabaseUrl =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_KEY ??
  process.env.SUPABASE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY."
  )
  process.exit(1)
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "Warning: using a non-service Supabase key for ingestion. This may fail if RLS is enabled."
  )
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
})

const csvContent = fs.readFileSync(filePath, "utf8")
const records = parse(csvContent, {
  columns: true,
  skip_empty_lines: true,
  trim: true,
})

const { data: ingestion, error: ingestionError } = await supabase
  .from("lead_ingestions")
  .insert({
    source: "csv",
    filename: path.basename(filePath),
  })
  .select()
  .single()

if (ingestionError) {
  console.error("Failed to create ingestion:", ingestionError.message)
  process.exit(1)
}

const companyCache = new Map()
const leadsToInsert = []
let skipped = 0

function pickField(row, candidates) {
  for (const key of candidates) {
    if (key in row && row[key]) return row[key]
  }
  return null
}

for (const record of records) {
  const normalizedKeys = {}
  for (const [key, value] of Object.entries(record)) {
    normalizedKeys[key.toLowerCase().trim()] = value
  }

  const companyName =
    pickField(normalizedKeys, [
      "company",
      "company name",
      "account",
      "account name",
      "account_name",
      "accountname",
    ])?.trim() ?? ""

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
      console.error("Failed to upsert company:", companyError.message)
      process.exit(1)
    }

    companyId = company.id
    companyCache.set(companyKey, companyId)
  }

  const firstName = pickField(normalizedKeys, [
    "first name",
    "first_name",
    "lead_first_name",
    "lead first name",
  ])
  const lastName = pickField(normalizedKeys, [
    "last name",
    "last_name",
    "lead_last_name",
    "lead last name",
  ])
  const fullName =
    pickField(normalizedKeys, [
      "name",
      "full name",
      "full_name",
      "contact",
      "person",
    ])?.trim() ?? [firstName, lastName].filter(Boolean).join(" ").trim()

  const title = pickField(normalizedKeys, [
    "title",
    "job title",
    "position",
    "role",
    "lead_job_title",
    "lead job title",
  ])
  const email = pickField(normalizedKeys, ["email", "email address"])
  const linkedinUrl = pickField(normalizedKeys, [
    "linkedin",
    "linkedin url",
    "linkedin_url",
    "linkedin profile",
  ])

  leadsToInsert.push({
    company_id: companyId,
    ingestion_id: ingestion.id,
    full_name: fullName || null,
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
    console.error("Failed to insert leads:", error.message)
    process.exit(1)
  }
}

console.log(
  `Loaded ${leadsToInsert.length} leads into ingestion ${ingestion.id}. Skipped ${skipped} rows without a company.`
)

import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import dotenv from "dotenv"
import { createClient } from "@supabase/supabase-js"

import { ingestCsvText } from "@/lib/ingest"

const envPath = fs.existsSync(".env.local") ? ".env.local" : ".env"
dotenv.config({ path: envPath })

function getArgValue(flag: string) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

const filePath = getArgValue("--file") ?? process.argv[2]

if (!filePath) {
  console.error("Usage: bun run ingest:leads -- --file path/to/leads.csv")
  process.exit(1)
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY."
  )
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
})

const csvContent = fs.readFileSync(filePath, "utf8")

const result = await ingestCsvText({
  supabase,
  csvText: csvContent,
  filename: path.basename(filePath),
  source: "csv",
})

console.log(
  `Loaded ${result.leadCount} leads into ingestion ${result.ingestionId}. Skipped ${result.skippedCount} rows without a company.`
)

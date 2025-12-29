import fs from "node:fs"
import process from "node:process"
import dotenv from "dotenv"
import { createClient } from "@supabase/supabase-js"

import { DEFAULT_PERSONA_QUERY_PROMPT } from "@/lib/prompts/persona-query"

const envPath = fs.existsSync(".env.local") ? ".env.local" : ".env"
dotenv.config({ path: envPath })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY; cannot update prompt settings."
  )
  process.exit(1)
}

const force = process.argv.includes("--force")

function looksLikeOldTemplate(text: string) {
  const normalized = text.toLowerCase()
  return (
    normalized.includes("single-paragraph") ||
    normalized.includes("single paragraph") ||
    normalized.includes("return only the query") ||
    normalized.includes("return only the query text")
  )
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
})

const { data, error } = await supabase
  .from("prompt_settings")
  .select("persona_query_prompt")
  .eq("id", "active")
  .single()

if (error) {
  console.error("Unable to read active prompt settings:", error.message)
  process.exit(1)
}

const currentPrompt = data?.persona_query_prompt ?? ""
const shouldUpdate = force || !currentPrompt || looksLikeOldTemplate(currentPrompt)

if (!shouldUpdate) {
  console.log(
    "Active persona_query_prompt does not look like the legacy template. Use --force to overwrite."
  )
  process.exit(0)
}

const { error: updateError } = await supabase
  .from("prompt_settings")
  .update({
    persona_query_prompt: DEFAULT_PERSONA_QUERY_PROMPT,
    updated_at: new Date().toISOString(),
  })
  .eq("id", "active")

if (updateError) {
  console.error("Failed to update persona_query_prompt:", updateError.message)
  process.exit(1)
}

console.log("Updated persona_query_prompt to the detailed rubric template.")

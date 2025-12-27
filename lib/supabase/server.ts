import { createClient } from "@supabase/supabase-js"

function getSupabaseEnv() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_KEY

  return { supabaseUrl, serviceRoleKey }
}

export function createSupabaseServerClient() {
  const { supabaseUrl, serviceRoleKey } = getSupabaseEnv()

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY."
    )
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
    },
  })
}

export function createSupabaseServerClientOptional() {
  const { supabaseUrl, serviceRoleKey } = getSupabaseEnv()

  if (!supabaseUrl || !serviceRoleKey) {
    return null
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
    },
  })
}

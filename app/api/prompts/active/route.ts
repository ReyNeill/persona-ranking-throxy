import { NextResponse } from "next/server"

import { createSupabaseServerClientOptional } from "@/lib/supabase/server"

export async function GET() {
  const supabase = createSupabaseServerClientOptional()
  if (!supabase) {
    return NextResponse.json({ prompt: null })
  }

  const { data, error } = await supabase
    .from("prompt_settings")
    .select("persona_query_prompt")
    .eq("id", "active")
    .single()

  if (error) {
    return NextResponse.json({ prompt: null, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ prompt: data?.persona_query_prompt ?? null })
}

import { NextResponse } from "next/server"

import { createSupabaseServerClientOptional } from "@/lib/supabase/server"

export async function GET() {
  const supabase = createSupabaseServerClientOptional()
  if (!supabase) {
    return NextResponse.json({ prompt: null })
  }

  const { data, error } = await supabase
    .from("prompt_leaderboards")
    .select("data")
    .eq("id", "active")
    .single()

  if (error) {
    return NextResponse.json({ prompt: null, error: error.message }, { status: 500 })
  }

  const entries = (data?.data as { entries?: Array<{ prompt?: string | null; score?: number | null }> } | null)
    ?.entries
  if (entries && entries.length > 0) {
    let bestPrompt: string | null = null
    let bestScore = -Infinity
    for (const entry of entries) {
      const score = typeof entry.score === "number" ? entry.score : -Infinity
      if (!entry.prompt) continue
      if (score > bestScore) {
        bestScore = score
        bestPrompt = entry.prompt
      }
    }
    if (bestPrompt) {
      return NextResponse.json({ prompt: bestPrompt })
    }
  }

  const { data: fallback, error: fallbackError } = await supabase
    .from("prompt_settings")
    .select("ranking_prompt")
    .eq("id", "active")
    .single()

  if (fallbackError) {
    return NextResponse.json({ prompt: null, error: fallbackError.message }, { status: 500 })
  }

  return NextResponse.json({ prompt: fallback?.ranking_prompt ?? null })
}

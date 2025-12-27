import { NextResponse } from "next/server"

import { createSupabaseServerClientOptional } from "@/lib/supabase/server"

export const runtime = "nodejs"

export async function GET() {
  const supabase = createSupabaseServerClientOptional()
  if (!supabase) {
    return NextResponse.json({
      objective: null,
      k: null,
      updatedAt: null,
      entries: [],
    })
  }

  const { data, error } = await supabase
    .from("prompt_leaderboards")
    .select("data, updated_at")
    .eq("id", "active")
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message, entries: [] }, { status: 500 })
  }

  const payload =
    data?.data && typeof data.data === "object"
      ? { ...data.data, updatedAt: data.updated_at ?? data.data.updatedAt }
      : null

  return NextResponse.json(
    payload ?? {
      objective: null,
      k: null,
      updatedAt: null,
      entries: [],
    }
  )
}

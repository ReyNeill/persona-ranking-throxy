import { createHash } from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

type AxisScores = {
  role?: number
  seniority?: number
  industry?: number
  size?: number
  data_quality?: number
}

type CachedScore = {
  leadId: string
  score: number
  axisScores: AxisScores | null
}

type CacheResult = {
  scores: Map<string, CachedScore>
  cacheKey: string
}

/**
 * Generate a cache key from persona spec and lead data
 */
export function generateCacheKey(
  personaSpec: string,
  companyId: string,
  leads: Array<{ id: string; title: string | null; full_name: string | null }>
): string {
  const leadData = leads
    .map((l) => `${l.id}:${l.title ?? ""}:${l.full_name ?? ""}`)
    .sort()
    .join("|")

  const content = `${personaSpec}::${companyId}::${leadData}`
  return createHash("sha256").update(content).digest("hex").slice(0, 32)
}

/**
 * Generate a short hash of just the persona spec (for indexing)
 */
export function generatePersonaHash(personaSpec: string): string {
  return createHash("sha256").update(personaSpec).digest("hex").slice(0, 16)
}

/**
 * Check cache for existing ranking results
 */
export async function checkRankingCache(
  supabase: SupabaseClient,
  cacheKey: string,
  companyId: string
): Promise<CacheResult | null> {
  const { data, error } = await supabase
    .from("ranking_cache")
    .select("results, hit_count")
    .eq("cache_key", cacheKey)
    .eq("company_id", companyId)
    .gt("expires_at", new Date().toISOString())
    .single()

  if (error || !data) {
    return null
  }

  // Increment hit count (fire and forget)
  supabase
    .from("ranking_cache")
    .update({ hit_count: (data.hit_count ?? 0) + 1 })
    .eq("cache_key", cacheKey)
    .eq("company_id", companyId)
    .then(() => {})

  const results = data.results as CachedScore[] | null
  if (!results || !Array.isArray(results)) {
    return null
  }

  const scores = new Map<string, CachedScore>()
  for (const item of results) {
    scores.set(item.leadId, item)
  }

  return { scores, cacheKey }
}

/**
 * Store ranking results in cache
 */
export async function storeRankingCache(
  supabase: SupabaseClient,
  cacheKey: string,
  companyId: string,
  personaHash: string,
  results: CachedScore[]
): Promise<void> {
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 7) // 7 day expiry

  await supabase.from("ranking_cache").upsert(
    {
      cache_key: cacheKey,
      company_id: companyId,
      persona_hash: personaHash,
      results,
      expires_at: expiresAt.toISOString(),
    },
    { onConflict: "cache_key,company_id" }
  )
}

/**
 * Calculate confidence score from axis scores
 *
 * Confidence is based on:
 * 1. Variance of axis scores (high variance = low confidence)
 * 2. Number of axis scores provided (missing = low confidence)
 * 3. Final score proximity to 0.5 (mid-range = uncertain)
 *
 * Returns a value between 0 and 1
 */
export function calculateConfidence(
  finalScore: number | null,
  axisScores: AxisScores | null
): { confidence: number; needsReview: boolean } {
  if (finalScore === null) {
    return { confidence: 0, needsReview: true }
  }

  let confidence = 1.0

  // Factor 1: Score certainty (scores near 0 or 1 are more certain)
  // Score of 0.5 = 0.5 certainty, scores of 0 or 1 = 1.0 certainty
  const scoreCertainty = Math.abs(finalScore - 0.5) * 2
  confidence *= 0.3 + scoreCertainty * 0.7

  // Factor 2: Axis score completeness and variance
  if (axisScores) {
    const values = [
      axisScores.role,
      axisScores.seniority,
      axisScores.industry,
      axisScores.size,
      axisScores.data_quality,
    ].filter((v): v is number => v !== undefined && v !== null)

    // Completeness: more axes = more confident
    const completeness = values.length / 5
    confidence *= 0.5 + completeness * 0.5

    // Variance: lower variance = more confident
    if (values.length >= 2) {
      const mean = values.reduce((a, b) => a + b, 0) / values.length
      const variance =
        values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
      // Normalize variance (max variance for 0-5 scale is ~6.25)
      const normalizedVariance = Math.min(variance / 6.25, 1)
      // Low variance = high confidence multiplier
      confidence *= 1 - normalizedVariance * 0.3
    }
  } else {
    // No axis scores = lower confidence
    confidence *= 0.6
  }

  // Clamp to 0-1
  confidence = Math.max(0, Math.min(1, confidence))

  // Flag for review if confidence < 0.5 or score is in uncertain range (0.35-0.55)
  const needsReview =
    confidence < 0.5 || (finalScore >= 0.35 && finalScore <= 0.55)

  return {
    confidence: Math.round(confidence * 100) / 100,
    needsReview,
  }
}

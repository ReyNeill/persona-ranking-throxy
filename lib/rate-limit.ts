import { createSupabaseServerClientOptional } from "@/lib/supabase/server"

/**
 * Simple rate limiter with a Supabase-backed store and in-memory fallback.
 *
 * Production behavior:
 * - Uses Postgres as a shared store (serverless-safe).
 *
 * Fallback behavior:
 * - Uses in-memory state when Supabase isn't configured.
 */

type RateLimitEntry = {
  count: number
  resetTime: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()

// Cleanup old entries every 5 minutes to prevent memory leaks
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000

let cleanupTimer: ReturnType<typeof setInterval> | null = null

function startCleanup() {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.resetTime < now) {
        rateLimitStore.delete(key)
      }
    }
  }, CLEANUP_INTERVAL_MS)
  // Don't prevent process exit
  if (cleanupTimer.unref) {
    cleanupTimer.unref()
  }
}

export type RateLimitConfig = {
  /** Maximum number of requests allowed within the window */
  limit: number
  /** Time window in milliseconds */
  windowMs: number
}

export type RateLimitResult = {
  success: boolean
  limit: number
  remaining: number
  resetTime: number
}

/**
 * Check if a request is within rate limits.
 *
 * @param identifier - Unique identifier for the client (e.g., IP address)
 * @param config - Rate limit configuration
 * @returns Result indicating if request is allowed and remaining quota
 */
function checkRateLimitInMemory(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  startCleanup()

  const now = Date.now()
  const key = `${identifier}`
  const entry = rateLimitStore.get(key)

  // If no entry or window has expired, create a new entry
  if (!entry || entry.resetTime < now) {
    const resetTime = now + config.windowMs
    rateLimitStore.set(key, { count: 1, resetTime })
    return {
      success: true,
      limit: config.limit,
      remaining: config.limit - 1,
      resetTime,
    }
  }

  // If within the window, check the count
  if (entry.count >= config.limit) {
    return {
      success: false,
      limit: config.limit,
      remaining: 0,
      resetTime: entry.resetTime,
    }
  }

  // Increment the count
  entry.count += 1
  return {
    success: true,
    limit: config.limit,
    remaining: config.limit - entry.count,
    resetTime: entry.resetTime,
  }
}

let warnedSupabaseError = false

/**
 * Check if a request is within rate limits.
 *
 * Falls back to in-memory if Supabase isn't configured or the RPC fails.
 */
export async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const supabase = createSupabaseServerClientOptional()

  if (supabase) {
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_key: identifier,
      p_window_ms: config.windowMs,
    })

    if (!error && data) {
      const row = Array.isArray(data) ? data[0] : data
      const count = Number(row?.count)
      const resetTimeValue = row?.reset_time
      const resetTimeMs =
        typeof resetTimeValue === "string"
          ? new Date(resetTimeValue).getTime()
          : Number.NaN

      if (Number.isFinite(count) && Number.isFinite(resetTimeMs)) {
        const remaining = Math.max(0, config.limit - count)
        return {
          success: count <= config.limit,
          limit: config.limit,
          remaining,
          resetTime: resetTimeMs,
        }
      }
    }

    if (!warnedSupabaseError) {
      warnedSupabaseError = true
      console.warn(
        "[rate-limit] Falling back to in-memory limiter; Supabase RPC failed.",
        error?.message ?? error
      )
    }
  }

  return checkRateLimitInMemory(identifier, config)
}

/**
 * Get client identifier from request headers.
 * Attempts to use X-Forwarded-For for proxied requests, falls back to a default.
 */
export function getClientIdentifier(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    // X-Forwarded-For can contain multiple IPs, take the first one
    return forwarded.split(",")[0].trim()
  }
  // In development or direct connections, we may not have a real IP
  // Use a combination of available headers as a fallback
  const realIp = request.headers.get("x-real-ip")
  if (realIp) return realIp
  // Default fallback for local development
  return "127.0.0.1"
}

// Default rate limit configurations
export const RATE_LIMITS = {
  /** Rate limit for ranking operations (expensive AI calls) */
  ranking: {
    limit: 10,
    windowMs: 60 * 1000, // 10 requests per minute
  },
  /** Rate limit for CSV ingestion */
  ingest: {
    limit: 5,
    windowMs: 60 * 1000, // 5 uploads per minute
  },
} as const

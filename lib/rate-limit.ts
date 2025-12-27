/**
 * Simple in-memory rate limiter using a sliding window algorithm.
 *
 * note: this implementation is intentionally simple for demonstration purposes.
 * for production at scale, i'd use something like Redis, etc.
 *
 * Limitations:
 * - State is lost on server restart
 * - Not suitable for multi-instance deployments without sticky sessions
 * - Memory grows with unique identifiers (IPs) until cleanup
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
export function checkRateLimit(
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


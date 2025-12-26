import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"

let lastCreateArgs: [string, string, Record<string, unknown>] | null = null

mock.module("@supabase/supabase-js", () => ({
  createClient: (url: string, key: string, options: Record<string, unknown>) => {
    lastCreateArgs = [url, key, options]
    return { url, key, options }
  },
}))

const { createSupabaseServerClient, createSupabaseServerClientOptional } =
  await import("../lib/supabase/server")

const originalEnv = { ...process.env }

beforeEach(() => {
  lastCreateArgs = null
  process.env = { ...originalEnv }
  delete process.env.SUPABASE_URL
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  delete process.env.SUPABASE_SERVICE_KEY
  delete process.env.SUPABASE_KEY
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
})

afterEach(() => {
  process.env = { ...originalEnv }
})

describe("createSupabaseServerClient", () => {
  it("throws when required env vars are missing", () => {
    expect(() => createSupabaseServerClient()).toThrow(
      "Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY."
    )
  })

  it("creates a client when env vars are present", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co"
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key"

    const client = createSupabaseServerClient() as any

    expect(client.url).toBe("https://example.supabase.co")
    expect(client.key).toBe("service-key")
    expect(lastCreateArgs?.[2]).toEqual({
      auth: {
        persistSession: false,
      },
    })
  })
})

describe("createSupabaseServerClientOptional", () => {
  it("returns null when env vars are missing", () => {
    expect(createSupabaseServerClientOptional()).toBeNull()
  })

  it("returns a client when env vars are present", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-key"

    const client = createSupabaseServerClientOptional() as any

    expect(client).not.toBeNull()
    expect(client.url).toBe("https://example.supabase.co")
    expect(client.key).toBe("publishable-key")
  })
})

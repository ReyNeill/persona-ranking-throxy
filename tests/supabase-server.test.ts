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
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.SUPABASE_SERVICE_KEY
})

afterEach(() => {
  process.env = { ...originalEnv }
})

describe("createSupabaseServerClient", () => {
  it("throws when required env vars are missing", () => {
    expect(() => createSupabaseServerClient()).toThrow(
      "Missing NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY."
    )
  })

  it("creates a client when env vars are present", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
    process.env.SUPABASE_SERVICE_KEY = "service-key"

    const client = createSupabaseServerClient() as unknown as {
      url: string
      key: string
    }

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
    process.env.SUPABASE_SERVICE_KEY = "service-key"

    const client = createSupabaseServerClientOptional() as unknown as {
      url: string
      key: string
    } | null

    expect(client).not.toBeNull()
    expect(client?.url).toBe("https://example.supabase.co")
    expect(client?.key).toBe("service-key")
  })
})

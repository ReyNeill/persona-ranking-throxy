import { describe, expect, it } from "bun:test"

import { cn } from "@/lib/utils"

describe("cn", () => {
  it("merges conditional classes", () => {
    const value = cn("text-sm", false && "hidden", "bg-white")
    expect(value).toBe("text-sm bg-white")
  })

  it("dedupes and resolves tailwind conflicts", () => {
    const value = cn("px-2", "px-4", "text-sm", "text-sm")
    expect(value).toBe("px-4 text-sm")
  })
})

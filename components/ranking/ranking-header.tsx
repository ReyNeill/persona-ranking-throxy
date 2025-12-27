"use client"

import Image from "next/image"
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler"

export function RankingHeader() {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Image
                src="/throxy-logo.avif"
                alt="PRS logo"
                width={96}
                height={42}
                className="relative h-9 w-auto dark:invert"
                priority
              />
            </div>
            <span className="border-primary/30 bg-primary/15 text-primary text-[10px] uppercase tracking-[0.35em] border px-2 py-1">
              PRS
            </span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-balance">
            Rank your next leads based on your spec.
          </h1>
          <p className="text-muted-foreground text-base">
            Provide the persona spec, run ranking, and surface only the most
            relevant contacts.
          </p>
        </div>
        <AnimatedThemeToggler className="border-border bg-background text-foreground hover:bg-muted flex size-9 items-center justify-center rounded-full border" />
      </div>
    </section>
  )
}

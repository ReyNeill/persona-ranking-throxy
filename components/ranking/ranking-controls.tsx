"use client"

import * as React from "react"
import { CircleHelp } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { RANKING_CONFIG } from "@/lib/constants"
import type { RankingProgress } from "@/components/ranking-types"

const DEFAULT_PERSONA_SPECS = [
  `We sell a sales engagement platform.
Target: revenue leaders (VP Sales, Head of Sales, Sales Ops, RevOps).
Avoid: HR, Recruiting, IT, Finance, Legal, or non-revenue roles.
Prefer mid-market to enterprise companies and decision-makers.`,
  `We help B2B marketing teams accelerate pipeline.
Target: demand gen, growth, and marketing ops leaders.
Avoid: student roles, recruiters, and customer support.
Prefer SaaS companies with 50–500 employees.`,
  `We provide outbound infrastructure for healthcare companies.
Target: VP Sales, Head of Growth, or Revenue Operations.
Avoid: clinicians, nurses, and non-commercial roles.
Prefer healthcare software or services companies.`,
  `We support manufacturing firms with AI-driven prospecting.
Target: sales leadership and business development heads.
Avoid: IT support, finance, and HR.
Prefer mid-market to enterprise manufacturers.`,
]

function pickRandomPersonaSpec() {
  const index = Math.floor(Math.random() * DEFAULT_PERSONA_SPECS.length)
  return DEFAULT_PERSONA_SPECS[index]
}

type RankingControlsProps = {
  onRun: (params: {
    personaSpec: string
    topN: number
    minScore: number
    csvFile: File | null
  }) => void
  isRunning: boolean
  isUploading: boolean
  progress: RankingProgress
  error: string | null
}

export function RankingControls({
  onRun,
  isRunning,
  isUploading,
  progress,
  error,
}: RankingControlsProps) {
  const [personaSpec, setPersonaSpec] = React.useState(() => pickRandomPersonaSpec())
  const [topN, setTopN] = React.useState<number>(RANKING_CONFIG.DEFAULT_TOP_N)
  const [minScore, setMinScore] = React.useState<number>(RANKING_CONFIG.DEFAULT_MIN_SCORE)
  const [csvFile, setCsvFile] = React.useState<File | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const handleSubmit = () => {
    onRun({ personaSpec, topN, minScore, csvFile })
    setCsvFile(null)
  }

  return (
    <Card className="ring-primary/10">
      <CardHeader>
        <CardTitle>Ranking Controls</CardTitle>
        <CardDescription>
          Configure the persona and pick how many leads per company to keep.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="grid gap-2 text-center md:col-start-2">
            <Label htmlFor="csv-upload" className="w-full text-center">
              Upload new leads (CSV)
            </Label>
            <input
              ref={fileInputRef}
              id="csv-upload"
              type="file"
              accept=".csv"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null
                setCsvFile(file)
              }}
            />
            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => fileInputRef.current?.click()}
              >
                {csvFile ? "Change CSV" : "Choose CSV"}
              </Button>
            </div>
            {csvFile ? (
              <p className="text-muted-foreground text-xs">
                Selected: {csvFile.name}
              </p>
            ) : null}
            <p className="text-muted-foreground text-xs">
              Upload a CSV to ingest and rank new leads immediately.
            </p>
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="persona-spec">Persona spec</Label>
          <Textarea
            id="persona-spec"
            value={personaSpec}
            onChange={(event) => setPersonaSpec(event.target.value)}
            className="min-h-[160px] resize-y"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="top-n">Top N per company</Label>
            <Input
              id="top-n"
              type="number"
              min={RANKING_CONFIG.MIN_TOP_N}
              max={RANKING_CONFIG.MAX_TOP_N}
              value={topN}
              onChange={(event) => setTopN(Number(event.target.value))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="min-score" className="flex items-center gap-2">
              Relevance threshold (0-1)
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="What does relevance threshold mean?"
                    className="text-muted-foreground hover:text-foreground inline-flex h-5 w-5 items-center justify-center rounded-full border border-border"
                  >
                    <CircleHelp className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  Minimum rerank score required to mark a lead as relevant. Only
                  relevant leads count toward Top N.
                </TooltipContent>
              </Tooltip>
            </Label>
            <Input
              id="min-score"
              type="number"
              min={RANKING_CONFIG.MIN_SCORE}
              max={RANKING_CONFIG.MAX_SCORE}
              step={0.05}
              value={minScore}
              onChange={(event) => setMinScore(Number(event.target.value))}
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={handleSubmit}
              disabled={isRunning || isUploading}
              className="w-full"
            >
              {isUploading
                ? "Uploading..."
                : isRunning
                  ? "Ranking..."
                  : "Run ranking"}
            </Button>
          </div>
        </div>

        {progress.status !== "idle" ? (
          <div className="border-border bg-muted/40 grid gap-3 rounded-none border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium">Ranking progress</span>
              {progress.total > 0 ? (
                <span className="text-muted-foreground">
                  {progress.completed}/{progress.total} companies
                </span>
              ) : (
                <span className="text-muted-foreground">Preparing...</span>
              )}
            </div>
            <Progress value={progress.percent} />
            {progress.message ? (
              <p className="text-muted-foreground text-xs">{progress.message}</p>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="text-destructive text-sm">{error}</p> : null}
      </CardContent>
    </Card>
  )
}


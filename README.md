Persona Ranking Throxy
======================

## Local setup

1) Install dependencies

```bash
bun install
```

2) Create `.env.local`

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
COHERE_API_KEY=...
OPENROUTER_API_KEY=...
RERANK_MODEL=rerank-v3.5
OPENROUTER_MODEL=openai/gpt-4o-mini
OPENROUTER_USAGE=true
OPENROUTER_COST_PER_1K_INPUT=
OPENROUTER_COST_PER_1K_OUTPUT=
OPENROUTER_COST_PER_1K_TOKENS=
COHERE_RERANK_COST_PER_SEARCH=
COHERE_RERANK_COST_PER_1K_SEARCHES=
COHERE_RERANK_COST_PER_1K_DOCS=
AI_DEVTOOLS=false
```

3) Apply the database schema

- Run the SQL in `supabase/migrations/20251226_persona_ranking.sql` **and** `supabase/migrations/20251226_ai_calls.sql`.
  (Alternatively, run all SQL files in `supabase/migrations/`.)

4) Load leads (CSV ingestion)

```bash
bun run ingest:leads -- --file path/to/leads.csv
```

5) Or upload a CSV in the UI and rank immediately (Ranking Controls section).

6) Start the app

```bash
bun run dev
```

Open `http://localhost:3000` to run ranking from the UI.

## Architecture overview

- Data model in Postgres/Supabase: companies, leads, personas, ranking runs, lead rankings.
- CSV ingestion via `scripts/ingest-leads.ts` (server-side) or `/api/ingest` (UI upload).
- Ranking pipeline in `/api/rank` (JSON) and `/api/rank/stream` (SSE):
  - (Optional) OpenRouter summarizes the persona spec into a concise query.
  - Cohere Rerank scores each lead per company.
  - Results are stored in `lead_rankings` and shown in the UI.
- The UI streams live progress + incremental table updates over SSE while ranking runs.
- AI usage is recorded per call in `ai_calls` and summarized in `/api/stats`.
- Results view in the homepage table, grouped by company.

## Key decisions

- **Per-company ranking**: we rank and select top N within each company to avoid over-contacting one account.
- **Relevance gating**: a min score threshold prevents obviously irrelevant roles from being selected.
- **Reusable pipeline**: ranking runs are stored independently, so future CSVs can be ingested and re-ranked without changing code.
- **AI providers**: OpenRouter for persona summarization, Cohere Rerank for deterministic ranking.

## Tradeoffs

- **Sync ranking (streamed)**: ranking runs in a single API request and streams progress to the UI. For larger CSVs, this should move to a background job/queue.
- **No auth / RLS policy**: MVP uses a service role key server-side only. Production should add auth and RLS.
- **Heuristic reasons**: reasons are templated rather than generated for every lead to keep latency and costs low.
- **Cost accuracy**: OpenRouter usage accounting is preferred when enabled. Cohere rerank cost should use per-search pricing (`COHERE_RERANK_COST_PER_SEARCH` or per-1k searches).
- **Cost units**: UI displays costs as “credits” (OpenRouter returns credits). Cohere rerank costs are USD-based; treat as credits for a consistent view.

## Deploy

- Deploy to Vercel and set the same environment variables.
- Configure the Supabase project URL and service role key in the Vercel dashboard.

## Notes

- The MVP expects a `COHERE_API_KEY` for reranking. If you want to swap providers, update `lib/ranking.ts`.
- To enable AI DevTools locally, set `AI_DEVTOOLS=true` and run `bunx @ai-sdk/devtools` (opens `http://localhost:4983`).

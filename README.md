Persona Ranking Throxy
======================

## Local setup

1) Install dependencies

```bash
npm install
```

2) Create `.env.local`

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
COHERE_API_KEY=...
OPENROUTER_API_KEY=...
RERANK_MODEL=rerank-v3.5
OPENROUTER_MODEL=openai/gpt-4o-mini
```

3) Apply the database schema

- Run the SQL in `supabase/migrations/20251226_persona_ranking.sql` on your Supabase project.

4) Load leads (CSV ingestion)

```bash
npm run ingest:leads -- --file path/to/leads.csv
```

5) Start the app

```bash
npm run dev
```

Open `http://localhost:3000` to run ranking from the UI.

## Architecture overview

- Data model in Postgres/Supabase: companies, leads, personas, ranking runs, lead rankings.
- CSV ingestion via `scripts/ingest-leads.mjs` (server-side, no UI required).
- Ranking pipeline in `/api/rank`:
  - (Optional) OpenRouter summarizes the persona spec into a concise query.
  - Cohere Rerank scores each lead per company.
  - Results are stored in `lead_rankings` and shown in the UI.
- Results view in the homepage table, grouped by company.

## Key decisions

- **Per-company ranking**: we rank and select top N within each company to avoid over-contacting one account.
- **Relevance gating**: a min score threshold prevents obviously irrelevant roles from being selected.
- **Reusable pipeline**: ranking runs are stored independently, so future CSVs can be ingested and re-ranked without changing code.
- **AI providers**: OpenRouter for persona summarization, Cohere Rerank for deterministic ranking.

## Tradeoffs

- **Sync ranking**: the pipeline runs in a single API request. For larger CSVs, this should move to a background job/queue.
- **No auth / RLS policy**: MVP uses a service role key server-side only. Production should add auth and RLS.
- **Heuristic reasons**: reasons are templated rather than generated for every lead to keep latency and costs low.

## Deploy

- Deploy to Vercel and set the same environment variables.
- Configure the Supabase project URL and service role key in the Vercel dashboard.

## Notes

- The MVP expects a `COHERE_API_KEY` for reranking. If you want to swap providers, update `lib/ranking.ts`.

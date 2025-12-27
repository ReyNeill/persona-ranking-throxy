Persona Ranking Throxy
======================

## Local setup

1) Install dependencies

```bash
bun install
```

2) Create `.env.local` from the example file

```bash
cp .env.example .env.local
```

Then fill in the values in `.env.local`.

3) Load leads (CSV ingestion)

```bash
bun run ingest:leads -- --file path/to/leads.csv (not recommended)
```

You can also ingest + run directly from the UI (Ranking Controls section).

### Prompt optimization

Use the evaluation set in `context/` to automatically improve the persona-to-query prompt.
This follows the "Automatic Prompt Optimization" (APO) approach from the reference article with a **beam search** loop, **prompt mutation operators**
(heuristic mutations), and **LLM-generated candidate prompts** (meta-prompting). We use a **company-level train/test split** to avoid leakage and
score candidates with **ranking metrics** (NDCG/MRR/precision/top1). The top prompts are stored in `prompt_leaderboards` and shown in the UI.

```bash
bun run optimize:prompt -- --rounds 3 --candidates 4 --beam 3
```

Example commands:

- Easy run (quick iteration):
  `bun run optimize:prompt -- --rounds 2 --candidates 3 --beam 2 --max-companies 10`
- Dry run (cost estimate only):
  `bun run optimize:prompt -- --dry-run --max-companies 20`
- Big run (deeper search):
  `bun run optimize:prompt -- --rounds 5 --candidates 6 --beam 4 --mutations 3 --max-companies 50 --budget-usd 20`

Optional flags:

- `--eval path/to/eval_set.csv`
- `--persona context/persona_spec.md`
- `--objective ndcg|mrr|precision|top1` (default: precision)
- `--max-companies 20` (faster iteration)
- `--train-ratio 0.8` (company-level split)
- `--mutations 2` (heuristic prompt mutations per round)
- `--include-employee-range` (adds eval-only employee range to documents)
- `--budget-usd 10` (exit if estimated cost exceeds budget)
- `--dry-run` (print cost estimate and exit)
- `--debug` (print optimizer meta-prompts + candidate prompts)

4) Start the app

```bash
bun run dev
```

Open `http://localhost:3000` to run ranking from the UI.

## Testing

Run the unit test suite with Bun (built-in test runner):

```bash
bun run test
```

## Key decisions

- **Relevance gating**: a min score threshold prevents obviously irrelevant roles from being selected if roles are provided on the schema.
- **No UI for Prompt Optimization**: it all happens locally via commands with the idea of our Ranking Persona service being used by external users (obvious gatekeeping).
- **Test suite**: there has to be one always (same applies to Bun).
- **Reason column**: the reason column is provided by heuristics instead of LLMs to reduce costs.
- **Realtime updates**: we are using SSE since we are only reading (not writing), discarding WebSockets.
- **Reusable pipeline**: ranking runs are stored independently, so future CSVs can be ingested and re-ranked without changing code.
- **AI providers**: OpenRouter for persona summarization (usage-based cost capture when enabled), Cohere Rerank for deterministic ranking.
- **Ranking system**: we are currently using AI ranking (Cohere's rerank-3.5 model using the latest AI SDK v6). AI ranking was decided by:
  1. Task recommendation
  2. Time and money (the best recommendation algorithms are tailored ML models; I have experience with this but it requires a budget and more time. Fine-tuning an existing OS ranking model on our data is also the best alternative option for faster deployment).

## Rate limiting

The API includes in-memory rate limiting for expensive operations:

- **Ranking** (`/api/rank/stream`): 10 requests per minute per IP
- **CSV upload** (`/api/ingest`): 5 requests per minute per IP

**Why in-memory instead of Redis?** This is a technical assessment, so I chose a simpler in-memory solution intentionally:

1. **Single-instance deployment**: The app runs on a single Vercel serverless function instance for this demo, making distributed state unnecessary.
2. **Zero external dependencies**: No need to provision something like Redis or Upstash for a task submission.
3. **Demonstrates the pattern**: The code structure (`lib/rate-limit.ts`) follows production patterns and can be easily swapped for Redis-based rate limiting (e.g., Upstash) by replacing the storage layer.

## Scope decisions (intentional)

These are some conscious tradeoffs for a scoped assessment (single-user demo), not production defaults:

- **Auth & data access**: API routes are unauthenticated and use a server-side service role to keep the flow simple. This means anyone with access to the deployment can trigger ranking/ingest and read results/cost data.
- **Rate limiting**: The in-memory limiter is only applied to streaming ranking + ingestion; the non-streaming rank route is left unguarded for internal/test use.
- **CSV ingest scale**: Ingestion reads the whole CSV in-memory and upserts companies per row; acceptable for small assessment datasets, not for large uploads.

## Deploy

- Deployed on Vercel at persona-ranking-throxy.vercel.app

## Notes

- To enable AI DevTools locally (AI SDK v6), set `AI_DEVTOOLS=true` and run `bunx @ai-sdk/devtools` (opens `http://localhost:4983`).

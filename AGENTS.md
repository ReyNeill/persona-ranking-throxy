# Repository Guidelines

## Project Structure & Module Organization
- `app/`: Next.js App Router pages and API routes (`app/api/*`).
- `components/`: Client components, including the ranking UI.
- `lib/`: Server-side helpers (Supabase client, AI ranking pipeline).
- `scripts/`: One-off scripts (CSV ingestion).
- `supabase/migrations/`: SQL schema for local/remote setup.
- `public/`: Static assets.
- `context/`: Provided project inputs (e.g., lead CSVs, persona specs).
- `todo.md`: Product backlog and optional ideas.

## Build, Test, and Development Commands
- Use `bun` for all commands in this repo.
- `bun run dev`: Start the Next.js dev server.
- `bun run build`: Build the production app.
- `bun run start`: Run the production server after build.
- `bun run lint`: Run ESLint.
- `bun run ingest:leads -- --file context/leads.csv`: Load a CSV into Supabase.

## Coding Style & Naming Conventions
- TypeScript + React with functional components and hooks.
- 2-space indentation, semicolons avoided unless required by tooling.
- File names use kebab-case (e.g., `ranking-client.tsx`).
- API routes live in `app/api/<route>/route.ts`.

## Agent-Specific Instructions
- For UI work, always use the shadcn MCP tools to source components and examples before implementation.

## Testing Guidelines
- No test framework configured yet.
- If adding tests, place them alongside source or in a `tests/` directory and document the chosen runner in `README.md`.

## Commit & Pull Request Guidelines
- No commit message convention is defined in this repo.
- Suggested: use short, imperative messages (e.g., “Add ranking API endpoint”).
- PRs should include: purpose, screenshots for UI changes, and any relevant env or migration notes.

## Security & Configuration Notes
- Server-side operations require `SUPABASE_SERVICE_ROLE_KEY`.
- Keep `.env.local` out of version control; reference `.env.example` for required vars.
- AI keys are required for ranking (`COHERE_API_KEY`, optional `OPENROUTER_API_KEY`).

## TODO
- Update OpenRouter integration to fully match AI SDK v6 typings as soon as the provider supports it.

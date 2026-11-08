````markdown name=README.md
# IKARUS 2026 Portal

The IKARUS 2026 portal supports competition participation and event operations for TechLift, DataQuest, and AI Nexus.

**Live portal:** https://ikarus-2026-portal-v2.kathrotheeshwar.workers.dev

## What it does

- Lets teams sign in with a registration ticket ID and confirm their team and event details.
- Provides Officer and President accounts for event administration.
- Supports objective quizzes, coding rounds, and activity rounds.
- Shows objective scores and current positions after completion; coding and activity results appear after organizer grading.
- Lets the President manage finalist qualification, approve results, and publish official public results.

Only the top five teams in each competition qualify for Round 3. Qualification is based on combined Round 1 and Round 2 scores, with faster combined submission time breaking ties. The President confirms finalists after grading.

## Competitions and rounds

| Competition | Round 1 | Round 2 | Round 3 |
| --- | --- | --- | --- |
| TechLift / Year 1 | 20 MCQs · 20 minutes · 20 marks | 2 coding problems · 40 minutes · 100 marks | Tech Mission · 60 minutes · 100 marks |
| DataQuest / Year 2 | 15 MCQs and 5 True/False · 15 minutes · 20 marks | 2 coding problems · 25 minutes · 100 marks | Data Detective · 60 minutes · 100 marks |
| AI Nexus / Year 3 | 20 MCQs · 20 minutes · 100 marks | 2 coding problems · 25 minutes · 100 marks | Choose one of 5 PBMs · 60 minutes · 100 marks |

Presentation and Q&A time is specified separately in the activity briefs.

## Project layout

- `ikarus2026-portal/` — portal frontend, Supabase functions, migrations, and project documentation
- `scripts/` — event-data verification and live acceptance utilities
- `tests/` — automated tests
- `START-HERE.md` — quick-start and operational notes
- `wrangler.jsonc` — Cloudflare Worker configuration

For detailed event and operations information, see [`ikarus2026-portal/README.md`](ikarus2026-portal/README.md).

## Run locally

From the repository root:

```bash
npm ci
npm test
npm run check
npm run build
npm run preview
```

The local preview is available at `http://127.0.0.1:4173`.

## Deploy

Build the project and deploy **only** the generated `dist/` folder. The build uses an explicit allowlist to keep private materials and operational files out of the web output.

To deploy the configured Cloudflare Worker:

```bash
npx wrangler deploy --keep-vars
```

## Backend

The portal uses Supabase for its backend. Database schema and migration files are in `ikarus2026-portal/`. For a new Supabase project, follow the migration order documented in [`ikarus2026-portal/README.md`](ikarus2026-portal/README.md).

## Verification

Run the standard checks:

```bash
npm test
npm run check
```

Additional scripts include `scripts/verify-event-data.cjs` for checking event data and `scripts/live-acceptance.cjs` for live acceptance checks.

## Protect private materials

Do not publish private materials, rosters, `.private-backups/`, SQL migrations, server tooling, or private judging references. Deploy only the generated `dist/` folder, and do not add sensitive materials to public documentation or releases.
````

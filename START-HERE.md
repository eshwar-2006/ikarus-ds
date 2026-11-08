# IKARUS 2026 portal

Live portal: https://ikarus-2026-portal-v2.kathrotheeshwar.workers.dev

Teams enter their ticket ID, confirm the team name and event, then continue. Officers and President use assigned email/password accounts.

All nine revised papers and all 39 supplied roster records have been loaded and verified. President can register spot teams, generate ticket IDs, grade/approve results, and open the competition-wise live scoreboard in projector mode.

Objective round scores and positions appear immediately. Coding/activity results appear after Officer or President grading. Public results require President publication.

Read `ikarus2026-portal/README.md` for the event structure and operational details. Source is in `ikarus2026-portal/`; deploy only the generated `dist/` folder.

```powershell
npm ci
npm test
npm run check
npm run build
npm run preview
```

Never publish private materials, rosters, `.private-backups/`, SQL migrations, or server tooling. The build excludes these automatically.

Only the top five combined Round 1 + Round 2 scorers per competition qualify for Round 3; faster combined submission time breaks score ties. President confirms finalists after grading. The highest Round 3 score determines the competition winner.

Screenshots: output/screenshots/index.html. Demo fixtures are local-only and removed after screenshot capture.

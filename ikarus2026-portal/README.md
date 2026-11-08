# IKARUS 2026 portal

Live frontend: https://ikarus-2026-portal-v2.kathrotheeshwar.workers.dev

## Team access

Teams select **Team portal**, enter the registration **Ticket ID**, verify the displayed team name/event/year, and confirm. The server creates or reuses the same authenticated team identity. Tickets are private team credentials. No email account or team password is required.

The supplied rosters were imported: TechLift (Year 1), DataQuest (Year 2), and AI Nexus (Year 3). Existing registrations were preserved. President **Spot registration** creates additional teams and generates unique ticket IDs.

## Event content

All nine supplied revised PDFs are loaded into the existing published stage IDs. Stage payloads, marks, durations, year groups, and all supplied roster records were compared against the reviewed manifests. Organizer-only solutions are private.

| Competition | Round 1 | Round 2 | Round 3 |
| --- | --- | --- | --- |
| TechLift / Year 1 | 20 MCQs, 20 minutes, 20 marks | 2 coding problems, 40 minutes, 100 marks | Tech Mission, 60 minutes, 100 marks |
| DataQuest / Year 2 | 15 MCQs + 5 True/False, 15 minutes, 20 marks | 2 coding problems, 25 minutes, 100 marks | Data Detective, 60 minutes, 100 marks |
| AI Nexus / Year 3 | 20 MCQs, 20 minutes, 100 marks | 2 coding problems, 25 minutes, 100 marks | Choose ONE of 5 PBMs, 60 minutes, 100 marks |

Presentation/Q&A time is described separately in the activity briefs. Data Detective includes all 12 dataset rows and a downloadable `bookstore_sales.csv`. Its private judging note corrects the supplied guide's inconsistent revenue totals: total revenue is 75,850 and Fiction revenue is 24,250. The supplied PDFs remain unchanged.

PDF-to-question generation and upload/conversion controls have been removed. Organizers can use the manual stage editor; private PDF references remain available for judging.

## Attempts, timers and focus

Each team has one attempt per stage. Objective quizzes use one-question navigation; coding and activity rounds show every question/section with its own marks and response fields. TechLift debugging and AI Nexus PBM responses have separate sub-section answer fields. Document-folder and presentation-video fields are saved with the corresponding response. Google Drive folders/files must use Anyone with the link - Viewer access. Answers autosave after edits and periodically. Refresh restores the saved answers and original server deadline. Late submissions use the last server-saved answers. A failed submission can be retried.

Assessment layout fills the screen. Objective quizzes request native browser fullscreen; leaving the tab/app or exiting fullscreen locks answers until the team returns. The timer continues and focus changes are recorded for organizer review. Browsers cannot fully prevent operating-system or tab switching. Coding and activity rounds allow the external tools specified in their papers.

## Scores and judging

Objective scores and current round positions appear immediately after completion. Coding, written responses, and activities are graded by the assigned event Officer or President in **Submissions & result approvals**. These rounds show **Awaiting judging** until a final score is entered, then the team sees its round score and position. Code is stored for manual judge review; the portal does not execute code. Judges select one team at a time, enter marks beside every question or rubric criterion, and save the complete allocation. Each mark is stored in `quiz_attempts.section_scores`; the server validates the allocation and calculates `reviewed_score`, including any automatic subtotal. Private guidance and reference answers appear only in the organizer view.

Team stage results refresh every 10 seconds. President **Live competition scoreboard** includes every eligible registered team and supports competition/round/overall filters, round points, totals, positions, judging state, and fullscreen projector view. It refreshes every 10 seconds and never displays ticket IDs. Equal correctness scores in DataQuest Round 1 use elapsed submission time as the paper specifies. No unsupported speed-score formula was invented.

Only President can approve and publish official results. The public results page continues to show only explicitly published results.

## Qualification and winner

Only the top five teams in each competition can enter Round 3. The President uses **Top 5 qualification & winner** after preliminary judging is complete. Teams must have completed both rounds; scores are added without normalization. Equal totals use faster combined elapsed submission time. An exact score-and-time cutoff tie requires a judging selection among the tied teams, and never admits more than five.

Confirming finalists closes Rounds 1 and 2 and locks their scores. Round 3 access is checked in the browser, every stage endpoint, and database attempt triggers. The President declares one winner from the highest graded Round 3 score after final judging. An equal highest final score requires judging review. Declaring the winner closes Round 3 and locks final scores. These operations use version checks and database locks to reject stale previews.

The leaderboard has TechLift, DataQuest, and AI Nexus event tabs. Qualification, individual rounds, and all-round points remain separate views. The Round 3 champion is highlighted independently of combined all-round points. Rank changes animate without recreating team rows; participant progress, stage entry, and submission completion have reduced-motion-aware animations.

## Run, test and deploy

From the parent workspace:

```powershell
npm ci
npm test
npm run check
npm run build
npm run preview
```

Preview is http://127.0.0.1:4173. Deploy only `dist/`; its explicit allowlist excludes private PDFs, roster files, SQL, server tools and backups.

```powershell
npx wrangler deploy --keep-vars
```

The tracked `wrangler.jsonc` targets the existing `ikarus-2026-portal-v2` Worker. The original Worker is retained.

## Backend

Project: `faxiasqmetqvdompxoxz`. Browser config contains only its public URL and publishable key.

For a new project, apply in order: `base-schema.sql`, `quiz-engine-migration.sql`, `competition-engine-migration.sql`, `portal-fixes-migration.sql`, `storage-access-migration.sql`, `ticket-login-migration.sql`, `round3-qualification-migration.sql`, `section-grading-migration.sql`. `npm run backend:prepare` prepares one transactional setup migration. Review existing schemas and keep a private backup before applying.

```powershell
npx supabase functions deploy --project-ref faxiasqmetqvdompxoxz --use-api --workdir ikarus2026-portal
```

Functions: publish/get/list/start/save/submit quiz, manage-results, public-results, manage-accounts, report-quiz-event, ticket-login, live-scoreboard. Only public-results and ticket-login disable gateway JWT verification. Ticket login uses an expiring signed team-confirmation challenge, server-side ticket lookup and rate limits. All other functions verify the authenticated user and assigned role.

Legacy public policies on question/attempt tables and private Storage were removed. Public and team accounts cannot read answer keys or organizer PDFs. Only server functions can write attempts or publish stages. Officer password recovery redirects include the deployed portal URLs.

Private source manifests, upload hashes, import SQL and pre-change snapshots are in the parent `.private-backups/`, excluded from source control and the web build. Do not publish that folder.

## Verification

`npm test` covers frontend DOM flows and Edge Function handlers with a controlled database double. `npm run check` checks JavaScript and TypeScript syntax, not full Deno types.

`scripts/verify-event-data.cjs` compares all stored stage payloads and supplied rosters with the reviewed manifests. `scripts/live-acceptance.cjs` tests live roles, ticket confirmation, spot registration, attempts, timers, scores/ranks, judging, publication and private materials using generated QA records, then cleans them up. Server credentials remain in memory and are not logged.

Headless Chrome was used for visual review, screenshot capture, and participant-progress/event-tab/rank-animation checks with temporary local demo fixtures. The fixtures and demo browser sessions were removed after capture. Screenshots and a gallery are in the parent output/screenshots folder. Rehearse browser-native fullscreen and campus connectivity on event devices.

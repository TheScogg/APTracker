# AP Tracker SQL Migration Toolkit

This folder is no longer the planned production runtime target.

AP Tracker’s SQL migration now points at the existing Cloudflare Worker plus Cloudflare D1, not Azure Functions plus Azure SQL. The live read-path implementation is being wired into:

- [worker.js](/Users/chris/APTracker/worker.js)
- [d1-api.js](/Users/chris/APTracker/d1-api.js)
- [migrations/0001_d1_core.sql](/Users/chris/APTracker/migrations/0001_d1_core.sql)

## What stays useful here

- Firestore import/backfill scripts
- Firestore-vs-SQL parity scripts
- Shared serializers that are still reused by the Worker D1 layer

## What is legacy here

- Azure Functions entrypoint assumptions
- `mssql` connection handling
- Azure-specific environment variable expectations

## Updated runtime direction

1. Browser sends Firebase ID token to the Worker API.
2. Worker verifies the Firebase user.
3. Worker checks `plant_members` permissions from D1.
4. Worker serves `/api/me`, `/api/plants/:plantId/bootstrap`, and issue read endpoints from D1.
5. Firebase Storage continues to hold attachment binaries during the first migration stages.

## Similar-fix research configuration

The Worker endpoint `POST /api/plants/:plantId/similar-fixes` searches resolved D1 issues in the authorized plant, then asks DeepSeek to compare those results with optional external research. Configure secrets in the Cloudflare deployment; never expose them in browser code:

```sh
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put BRAVE_SEARCH_API_KEY
```

`BRAVE_SEARCH_API_KEY` is optional. Without it, the feature still returns D1-backed internal fixes and marks external research unavailable. `DEEPSEEK_MODEL` may be set as a Worker variable to override the default `deepseek-v4-flash`.

## Recommended next repo steps

1. Bind your Cloudflare D1 database in `wrangler.jsonc`.
2. Apply `migrations/0001_d1_core.sql`.
3. Apply `migrations/0002_d1_collab_content.sql` before importing notes, todos, conversations, leaderboard/XP, or wiki content into an existing D1 database.
4. Apply `migrations/0003_d1_remaining_content.sql` before importing role-feed alerts or press notes into an existing D1 database.
5. Apply `migrations/0004_d1_daily_schedules.sql` before importing `dailySchedules` or plant `config/store` docs into an existing D1 database.
6. Use the updated import/parity scripts against D1 instead of SQL Server.
7. Add D1-backed write endpoints once read parity is stable.

## Current D1 script usage

- Dry-run import summary:
  `npm run import:plant -- --plant <plantId>`
- Firestore collection audit for a plant:
  `npm run audit:plant -- --plant <plantId>`
- Same audit as JSON:
  `npm run audit:plant -- --plant <plantId> --json`
- Import into local D1 via Wrangler:
  `npm run import:plant -- --plant <plantId> --database <db-name> --commit`
- Import into remote D1:
  `npm run import:plant -- --plant <plantId> --database <db-name> --remote --commit`
- Parity check against local D1:
  `npm run parity:plant -- --plant <plantId> --database <db-name>`
- Parity check against remote D1:
  `npm run parity:plant -- --plant <plantId> --database <db-name> --remote`

Both scripts also accept `APTRACKER_D1_DATABASE_NAME` instead of `--database`.

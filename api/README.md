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

## Recommended next repo steps

1. Bind your Cloudflare D1 database in `wrangler.jsonc`.
2. Apply `migrations/0001_d1_core.sql`.
3. Update the import/parity scripts to write to and read from D1 instead of SQL Server.
4. Add D1-backed write endpoints once read parity is stable.

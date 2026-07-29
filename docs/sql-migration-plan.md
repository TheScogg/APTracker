# AP Tracker D1 Migration Plan

This plan keeps the current app behavior intact while moving the SQL migration target from Azure SQL to Cloudflare D1. Firebase Auth and Firebase Storage remain in service during the first cutover phases.

## Target architecture

- Static app and API stay on the current Cloudflare Pages/Workers deployment shape.
- Browser sends Firebase ID tokens to the Worker API with `Authorization: Bearer <idToken>`.
- The Worker verifies Firebase ID tokens, resolves plant permissions from D1, and serves the SQL read path.
- Cloudflare D1 stores app metadata and operational records currently mirrored from Firestore.
- Firebase Storage continues storing photos and attachment binaries; D1 stores attachment metadata and storage paths.
- Realtime starts with polling against the HTTP API, with Durable Objects or WebSockets only if polling becomes a clear bottleneck.

## Current repo direction

- Read endpoints now belong in the main Worker, not a separate Azure Functions app.
- The shared frontend contract in `data-api.js` remains valid.
- The first D1 migration lives at `migrations/0001_d1_core.sql`.
- `api/` is now best treated as import/parity tooling and legacy scaffold reference, not the production runtime target.

## Migration phases

### Phase 1: D1 foundation

- Create the D1 schema for the core Firestore collections.
- Bind the D1 database in `wrangler.jsonc`.
- Keep the existing Firebase runtime untouched for writes and live listeners.
- Route SQL read endpoints through the existing Worker under `/api/...`.

### Phase 2: D1 read path

- Implement `GET /api/me`.
- Implement `GET /api/plants/:plantId/bootstrap`.
- Implement issue list/detail/events/attachments reads from D1.
- Backfill Firestore data into D1.
- Run parity checks against Firestore by plant.
- Enable staged SQL reads in the frontend with `?dataBackend=sql`.

### Phase 3: D1 write path

- Implement issue create/update/status-change/event append through the Worker API.
- Preserve append-only event semantics.
- Continue writing attachment binaries to Firebase Storage while persisting metadata in D1.
- Keep Firebase writes available behind a rollback switch until cutover is accepted.

### Phase 4: production cutover

- Freeze Firestore writes during the cutover window.
- Run final export/import and parity checks.
- Deploy the frontend with SQL API mode enabled.
- Monitor bootstrap, issue reads, writes, and attachment metadata.
- Keep Firestore data intact as a rollback snapshot until the D1-backed app is accepted.

## Core API surface

- `GET /api/me`
- `GET /api/plants/:plantId/bootstrap`
- `GET /api/plants/:plantId/issues`
- `POST /api/plants/:plantId/issues`
- `GET /api/plants/:plantId/issues/:issueId`
- `PATCH /api/plants/:plantId/issues/:issueId`
- `GET /api/plants/:plantId/issues/:issueId/events`
- `POST /api/plants/:plantId/issues/:issueId/events`
- `GET /api/plants/:plantId/issues/:issueId/attachments`
- `POST /api/plants/:plantId/issues/:issueId/attachments`

Admin, wiki, notes, todos, messaging, schedules, and gamification should follow the same Worker API pattern after the core issue flow is stable.

## Permission model

Firestore rules move into Worker middleware:

- Verify Firebase ID token.
- Resolve `uid`.
- Load active `plant_members` row for the requested `plant_id`.
- Check permissions JSON for action-specific rights.
- Deny access before any plant-scoped D1 query runs.

Every plant-scoped D1 query must include `plant_id`.

## Backfill order

1. `users`
2. `plants`
3. `plant_members`
4. `access_requests`
5. `plant_status_config`
6. `plant_press_config`
7. `presses`
8. `issues`
9. `issue_events`
10. `issue_attachments`
11. notes, todos, wiki, messaging, alerts, schedules, and gamification

## Parity checks

- Users by UID.
- Plants by ID.
- Members by plant and active status.
- Issues by plant.
- Issue workflow maps by plant, including `workflow_state_by_entry_json`, `workflow_state_by_entry_history_json`, `workflow_state_by_status_json`, and `workflow_state_by_status_history_json`.
- Open/resolved issue counts by plant.
- Current status distribution by plant.
- Event counts per issue.
- Attachment counts per issue.
- Latest created/updated timestamps.
- Leaderboard and user XP totals where gamification is migrated.

## Wrangler binding template

Add a D1 binding once you have the database name and ID:

```jsonc
{
  "d1_databases": [
    {
      "binding": "APTRACKER_DB",
      "database_name": "your-database-name",
      "database_id": "your-database-id"
    }
  ]
}
```

Cloudflare’s current docs for the binding and local dev flow:

- [D1 Worker API](https://developers.cloudflare.com/d1/worker-api/)
- [D1 local development](https://developers.cloudflare.com/d1/build-with-d1/local-development/)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)

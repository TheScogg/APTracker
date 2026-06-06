# AP Tracker SQL Migration Plan

This plan starts the Firebase-to-SQL switchover while preserving the current app behavior. The first migration target is Azure SQL behind an Azure-hosted HTTP API. Firebase Auth and Firebase Storage remain in service during phase one.

## Target architecture

- Static app remains deployable as the current Cloudflare Pages/Workers asset app.
- Browser sends Firebase ID tokens to the SQL API with `Authorization: Bearer <idToken>`.
- Azure Functions or Azure App Service verifies Firebase ID tokens and enforces plant permissions from SQL.
- Azure SQL stores all app metadata and operational records currently stored in Firestore.
- Firebase Storage continues storing photos and attachments; SQL stores object metadata and storage paths.
- Azure SignalR replaces Firestore `onSnapshot` for live updates after the HTTP API is stable.

## Migration phases

### Phase 1: foundation

- Add Azure SQL schema for core Firebase collections.
- Add an API scaffold with explicit auth, permission, and route boundaries.
- Add a frontend data adapter interface that can be implemented by Firebase or SQL.
- Keep the existing Firebase runtime untouched.

### Phase 2: SQL API read path

- Implement API endpoints for user bootstrap, plant bootstrap, issue list, issue details, events, and attachments.
- Add SQL import scripts that backfill Firebase data into SQL.
- Build parity checks that compare Firestore counts and important derived values against SQL.
- Add a config flag that lets the frontend use SQL reads in staging.

### Phase 3: SQL write path

- Implement issue create/update/status-change/event append through the SQL API.
- Preserve append-only event semantics.
- Publish SignalR update events from successful SQL writes.
- Keep Firebase writes available only for rollback until production cutover.

### Phase 4: production cutover

- Freeze Firestore writes during the cutover window.
- Run final export/import and parity checks.
- Deploy the frontend with SQL API mode enabled.
- Monitor issue creation, issue updates, attachment metadata, login/bootstrap, and realtime update delivery.
- Keep Firestore data intact as a rollback snapshot until the SQL app is accepted.

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

Admin, wiki, notes, todos, messaging, schedules, and gamification should follow the same API pattern after the core issue flow is stable.

## Permission model

Firestore rules move into API middleware:

- Verify Firebase ID token.
- Resolve `uid`.
- Load active `plant_members` row for the requested `plant_id`.
- Check permissions JSON for action-specific rights.
- Deny access before any plant-scoped SQL query runs.

Every plant-scoped SQL query must include `plant_id`.

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
- Open/resolved issue counts by plant.
- Current status distribution by plant.
- Event counts per issue.
- Attachment counts per issue.
- Latest created/updated timestamps.
- Leaderboard and user XP totals where gamification is migrated.

## Cutover checklist

- Staging SQL import passes parity checks.
- SQL API can run app bootstrap and issue workflows in staging.
- SignalR or polling fallback is validated for live issue updates.
- Production Firestore write freeze window is scheduled.
- Final import and parity scripts are ready.
- Rollback deploy target remains available.
- Firestore data is preserved read-only after cutover.

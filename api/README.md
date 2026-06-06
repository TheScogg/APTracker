# AP Tracker SQL API Scaffold

This directory is the starting point for the Azure-hosted API that will replace direct browser-to-Firestore data access.

## Runtime target

- Azure Functions or Azure App Service
- Azure SQL Database
- Firebase Auth token verification
- Firebase Storage retained for attachment binaries during phase one
- Azure SignalR added after the HTTP API is stable

## First implementation order

1. Wire Firebase token verification.
2. Add Azure SQL connection pooling.
3. Implement `GET /api/me`.
4. Implement `GET /api/plants/:plantId/bootstrap`.
5. Implement issue list/detail endpoints.
6. Implement issue writes and append-only events.
7. Add parity/import scripts.
8. Add SignalR publish hooks.

## Currently implemented

- `GET /api/me`
- `GET /api/plants/:plantId/bootstrap`
- `GET /api/plants/:plantId/issues`
- `GET /api/plants/:plantId/issues/:issueId`
- `GET /api/plants/:plantId/issues/:issueId/events`
- `GET /api/plants/:plantId/issues/:issueId/attachments`

## Staging checks

- Frontend SQL staging reads can be enabled with `?dataBackend=sql`.
- The current app wiring uses SQL for signed-in bootstrap and issue detail hydration, while live issue lists and writes stay on Firebase.
- Run `npm run import:plant -- --plant <plantId>` for a dry-run import summary.
- Run `npm run import:plant -- --plant <plantId> --commit` to upsert one plant's bootstrap data, issues, events, and attachment metadata into SQL.
- Run `npm run parity:plant -- --plant <plantId>` from `api/` to compare Firestore and SQL counts for one plant.

## Environment variables

- `SQL_CONNECTION_STRING`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `SIGNALR_CONNECTION_STRING` once realtime migration begins

## Security rule replacement

Every plant-scoped route must:

1. Verify Firebase ID token.
2. Load `plant_members` for `(plant_id, uid)`.
3. Require `is_active = 1`.
4. Check action-specific permissions from `permissions_json`.
5. Include `plant_id` in every SQL query.

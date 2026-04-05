# Phase 3 Backfill Runbook (Firestore v2)

This script backfills legacy issue docs to the v2 compatibility shape and creates historical `events` when missing.

## Script

- `scripts/backfill-issues-v2.mjs`

## What it does

For each `issues` document found via `collectionGroup('issues')`:

1. Adds/repairs v2 fields:
   - `schemaVersion: 2`
   - `pressId`
   - `rowId`
   - `machineCode`
   - `currentStatus`
   - `lifecycle`
2. Writes migration metadata:
   - `migration.v2Phase3BackfilledAt`
3. Creates historical `status_changed` events **only when no events exist yet**.

## Safety behavior

- Default mode is **dry-run** (no writes).
- Use `--commit` to perform writes.
- Event documents use stable IDs (`legacy_*`) for repeatable/idempotent inserts.

## Prerequisites

- Service account credentials via `GOOGLE_APPLICATION_CREDENTIALS`.
- Optional: `FIREBASE_PROJECT_ID`.
- `firebase-admin` package available in the execution environment.

## Example

```bash
node scripts/backfill-issues-v2.mjs --dry-run
node scripts/backfill-issues-v2.mjs --commit
```

## Notes

- Row mapping is derived from each plant's legacy `plants/{plantId}/config/presses` document.
- If an issue already has events, this script does not generate legacy historical events for it.
- This script intentionally preserves legacy fields for phase-1/2 compatibility.

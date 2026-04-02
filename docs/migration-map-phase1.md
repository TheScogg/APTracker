# AP Tracker Modernization — Migration Map (Phase 1 Baseline)

This document audits the current `index.html` implementation against `CLAUDE.md` and defines a smallest-safe migration path that preserves behavior.

## Behavioral Source of Truth

- Canonical requirements source: `CLAUDE.md`.
- Current runtime implementation audited: `index.html` (single-file app with Firebase Auth + Firestore).

## 1) Migration Map (CLAUDE.md → Current Implementation)

### auth/init
- Firebase app/auth/firestore initialization lives in the module script block.
- `onAuthStateChanged` is the main startup entry point.
- Phase 1 structure refactor introduces `bootstrapSignedInSession(user)` for startup sequencing and keeps previous call order behavior (including floor map prebuild + full hydrate sequence).

### plant switching
- Multi-plant state and helpers are present (`currentPlantId`, `loadUserPlants`, `loadPlantPresses`, `switchPlant`, `addNewPlant`).
- Firestore user profile stores `plants` and `lastPlant`.
- Phase 1 introduces `hydrateCurrentPlantView()` and uses it from `switchPlant` and auth bootstrap to reduce duplicate startup paths without behavior changes.

### Firestore paths/helpers
- `plantCol(colName)` and `plantDoc(colName, docId)` are present and used for plant-scoped data.
- Paths align with `plants/{plantId}/...` model for issues and config docs.

### listener lifecycle/retry
- `startListener()` uses `onSnapshot(query(...orderBy('createdAt','desc')))`.
- Retry logic uses incremental backoff up to 15s and supports manual retry button.
- Listener teardown occurs on plant switch/sign-out and before re-subscribing.

### status config system
- `STATUSES` object exists in code as default/fallback and is loaded from `plants/{plantId}/config/statuses`.
- `rebuildDerivedStatus()` rebuilds `_ALL_STATUSES` and `_STATUS_ORDER`, plus pills/dropdown.
- Admin saves statuses back to Firestore.

### issue CRUD
- Add/edit/resolve/reopen flows are implemented.
- Issue docs include status timeline data and legacy compatibility fields.
- File/photo handling and resizing are present.

### status history timeline
- Canonical status state is derived from latest `statusHistory` entry (`currentStatusKey`).
- Timeline mutation helpers exist (`addStatusEntry`, `updateStatusEntry`, `removeStatusEntry`).
- Serial-number prompt hooks into timeline additions.

### floor map rendering
- Floor rows/tabs/panels are generated from plant `PRESSES` layout.
- Press interactions support mini-card actions, report/history flows, and row state persistence.

### issue log rendering
- `renderIssues()` applies period/scope/filter/sort logic and renders cards with timeline/actions.
- Expanded-card preservation and interaction controls are present.

### masonry
- `CLAUDE.md` describes JS masonry; current file indicates CSS Grid has replaced JS masonry layout.
- No `layoutMasonry()` behavior currently active.

### swipe interactions
- Swipe-open category panel, sub-status selection, and close/cancel behavior are implemented.
- Touch + mouse gesture handling and guard flags are present.

### admin panel
- Admin status management (edit/add/delete/reorder/save/reset) is present.
- Changes persist to Firestore and rebuild derived status data.

### export PDF
- Export modal builds print HTML from current filtered issues.
- `downloadPDF()` uses html2pdf.js.

## 2) Mismatches / Regressions / Fragile Areas

1. **Status color mismatch in one renderer path**
   - `buildStatusFilterPills()` currently uses `config.color`, while other paths prefer `swipeColor || cssColor || color`.
   - This can cause inconsistent dots for built-in statuses.

2. **Auto-migration side effect risk in `loadConfig()`**
   - If certain keys are missing, status config is force-saved from in-code defaults.
   - This can unintentionally overwrite admin-managed custom taxonomy for older plants.

3. **Unknown/deleted status fallback handling is partial**
   - Some places guard unknown keys; others assume `STATUSES[key]` exists.
   - Can still surface undefined labels/styles when historical status keys no longer exist.

4. **Masonry drift from source-of-truth doc**
   - `CLAUDE.md` expects JS masonry lifecycle, but implementation is now CSS Grid.
   - Needs explicit acknowledgement in future architecture docs/tests so behavior expectations stay aligned.

5. **Listener/state coupling spread across many call sites**
   - Startup/refresh logic repeated in multiple places increases regression risk during modularization.

## 3) Phased Migration Plan (Smallest Safe Steps)

### Phase 1 (this change)
- No behavioral changes.
- Introduce lifecycle helper functions to centralize startup/refresh sequencing.
- Add migration-map documentation to freeze current behavior contract before modular extraction.

### Phase 2
- Extract pure read helpers and selectors (status/color/date/filter derivations) into isolated module(s).
- Add unknown-status fallback helper and route all status label/color rendering through it.
- Keep DOM output parity by snapshot testing critical render fragments.

### Phase 3
- Extract Firestore gateway (plant-scoped paths + issue/status config read/write) behind explicit API.
- Keep `statusHistory` as canonical current-state resolver.
- Add listener lifecycle manager with deterministic teardown/retry tests.

### Phase 4
- Extract UI modules by domain (floor map, issue log, admin, export, modals/swipe).
- Replace global mutable state with a small shared app-state store + reducer-style updates (no framework).

## 4) Phase 1 Implementation Notes

Implemented in this phase:
- Added `refreshVisibleData()` for consistent render/update fan-out.
- Added `hydrateCurrentPlantView()` to centralize plant-level press+config hydration.
- Added `bootstrapSignedInSession(user)` to consolidate signed-in startup sequence.
- Updated `switchPlant`, `onAuthStateChanged` signed-in path, and snapshot success path to use helpers.

Behavioral intent:
- No feature removals.
- No Firebase path/schema changes.
- No status workflow model changes.
- App remains runnable as a single-file implementation.

## 5) Phase 1 Risk / Verification Notes

Not fully verified in this environment (manual browser-run needed):
- End-to-end Google Auth popup flow.
- Firestore realtime listener and retry display behavior.
- Touch swipe gestures on physical mobile devices.
- PDF generation rendering fidelity across browsers.

## 6) Phase 2 Completed (Status selector extraction + unknown fallback hardening)

Completed in this update:
- Added centralized status selector helpers in `index.html`:
  - `getStatusDef(statusKey)`
  - `getStatusColor(statusKey)`
  - `getStatusLabel(statusKey, mode)`
  - `getStatusSubs(statusKey)`
- Added `STATUS_FALLBACK` so deleted/unknown status keys render safely instead of surfacing `undefined` UI labels or crashing render paths.
- Routed high-risk rendering paths through helpers (status pills, status dropdown labels, row-panel pills, press color bars, log-category/sub chips, swipe tiles/sub chips, stats labels, serial modal status badge).
- Fixed the status filter pill color path to use canonical color resolution (`swipeColor || cssColor || color`) instead of `config.color` only.

Phase 2 intent preserved:
- No Firestore schema/path changes.
- No statusHistory model changes.
- No feature removal; this is a rendering/selector hardening step.

## 7) Masonic React plugin integration (issue log)

Implemented in this update:
- Added a progressive-enhancement layout path for the issue log using the React `masonic` plugin.
- Added runtime loader `ensureMasonicRuntime()` (React + ReactDOM Client + masonic via ESM CDN imports).
- Added `applyIssueLogLayout()` that:
  - falls back to existing grid layout on mobile (`<=480px`) or runtime load failures,
  - mounts masonic for desktop issue rows,
  - preserves existing issue-card behavior by reusing already-rendered DOM rows and moving them into masonic cells.
- Updated `renderIssues()` to reset any previous masonic root before redraw, then apply masonic layout after cards are rendered.
- Added `.issues-list.masonic-enabled` CSS mode and `data-id` on each `.issue-row` for stable item identity.

Behavioral safety:
- Existing grid path remains as fallback.
- Issue card interactions remain intact because original DOM nodes and listeners are reused.

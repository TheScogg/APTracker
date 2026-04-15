# AP Tracker — claude.md

## Project overview

AP Tracker is a manufacturing-floor issue tracker built primarily as a **single-file web app** (`index.html`) using vanilla JavaScript and Firebase. It is optimized for tablets/phones on the floor, with a split-map + issue-log UX, swipe-driven status updates, and optional PDF export.

### Current primary surfaces
- `index.html` — production app shell + runtime logic (~6,580 lines)
- `admin.html` — plant/member/status administration portal (~1,920 lines)
- `demo.html` — large interactive demo/prototype variant (~2,148 lines)
- `migration-plant-structure.html` — one-off migration helper
- `ap-tracker-job-mascots-v2.html` — mascot/job-role visual utility page

### Stack
- Vanilla JS + inline HTML/CSS (no framework build pipeline)
- Firebase JS SDK `10.12.2` (App, Firestore, Auth, Storage)
- `html2pdf.js` for PDF generation
- Cloudflare Pages/Workers static deployment (`wrangler.jsonc`, `assets.directory = "."`)

---

## Architecture snapshot (re-evaluated)

### 1) Data model: plant-scoped multi-tenant Firestore
All operational data is under `plants/{plantId}/...` with per-plant issues, config, and member ACLs. User profile routing data lives under `users/{uid}`; lookup index for member invite flows lives under `userLookup/{email}`.

Core paths:
- `plants/{plantId}/issues/{issueId}`
- `plants/{plantId}/issues/{issueId}/events/{eventId}` (append-only log)
- `plants/{plantId}/issues/{issueId}/attachments/{attachmentId}` (photo metadata)
- `plants/{plantId}/config/statuses`
- `plants/{plantId}/config/presses`
- `plants/{plantId}/members/{uid}`
- `users/{uid}` and `userLookup/{email}`

### 2) Dual-track schema strategy (v2 operational + compatibility)
The app writes and reads **v2 issue schema** while preserving compatibility fields and fallback logic for older docs. Rendering and filtering path intentionally handles mixed data (legacy + v2) without hard failures.

### 3) Event-first history + hydration caches
Issue timeline history is increasingly event-centric via `events` subcollections; UI hydration normalizes events into timeline-friendly records. Async hydration is guarded by plant-switch tokens (`attachmentsHydrationToken`, events token pattern) to prevent stale updates crossing plant boundaries.

### 4) Status engine is runtime-configurable
`STATUSES` is loaded from Firestore config and treated as dynamic source-of-truth in runtime. UI components consume status metadata through helper functions and inline style color application so custom admin-defined statuses render without new CSS class shipping.

### 5) Role-aware UI + rule-enforced backend
UI gates admin features based on role/permissions loaded from member docs, but Firestore security rules are the authoritative enforcement layer (`firestore.rules`). This is a proper defense-in-depth posture for floor clients.

### 6) Gamification subsystem (important newer capability)
`index.html` includes a meaningful gamification module with:
- XP awards + dedupe keys
- level progression
- streak and counters
- mission progress docs
- weekly leaderboard docs
- configurable badge definitions and rewards

This subsystem uses additional plant-scoped collections/docs and real-time listeners and is now a first-class behavior area (not a side experiment).

---

## Functional capabilities (current)

- Google sign-in + session bootstrap
- Multi-plant switching and per-plant data isolation
- Press/floor map interaction with row and machine filtering
- Issue create/edit/resolve/reopen with lifecycle tracking
- Status timeline updates (including serial-number-required flows)
- Photo upload to Firebase Storage + attachment metadata persistence
- Real-time issue updates with retry/backoff listener strategy
- PDF export from filtered issue set
- Admin portal for plants, members, and status configuration
- Optional gamification feedback loop (XP/missions/badges/leaderboard)

---

## Key implementation patterns to preserve

1. **Path helper abstraction** for all plant-scoped Firestore access.
2. **Compat-safe reads** (`currentStatus` + fallback fields + fallback label/status def).
3. **Tokenized async hydration cancellation** during plant changes.
4. **Inline status colors** for custom status portability.
5. **Append-only events where possible**, mutable timeline only when explicitly editing history.
6. **Client-side UX resiliency** (expanded-card state preservation, swipe/toggle guardrails, listener retry).

---

## Repository reality check

This repository is currently centered on static HTML entry points and migration/docs/scripts. References to pages like `debug.html`, `kitty.html`, `copy-statuses.html`, or `migrate-to-plants.html` are **not present in this checkout** and should be treated as historical unless reintroduced.

---

## Migration + ops artifacts

- `docs/firestore-schema-v2.md` — canonical schema guidance
- `docs/security-rules-v2.md` — rules rationale and structure
- `docs/manage-access-flow.md` — role/permission operational flow
- `docs/migration-map-phase1.md` and `docs/phase3-backfill.md` — migration planning and execution checkpoints
- `scripts/backfill-issues-v2.mjs`
- `scripts/backfill-attachments-v2.mjs`
- `scripts/cleanup-legacy-v1-fields.mjs`

---

## Suggested working contract for future edits

- Treat `index.html` as production-critical monolith: avoid broad refactors without focused regression checks.
- Any schema/security change must update both docs and rules/index artifacts.
- Keep admin and runtime status models in lockstep (`DEFAULT_STATUSES` expectations).
- Preserve migration-safe behavior for mixed legacy/v2 issue records until cleanup scripts are fully complete in production.

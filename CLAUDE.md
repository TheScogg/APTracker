# AP Tracker — CLAUDE.md

## Project overview

AP Tracker is a single-file HTML/JS web application for tracking injection molding press issues across multiple manufacturing plants. It runs entirely client-side with Firebase (Firestore + Auth + Storage) as the backend. The app is used on the factory floor on phones, tablets, and desktop monitors.

**File:** `index.html` (~4,750 lines, single file containing all HTML, CSS, and JS)

**Stack:** Vanilla JS (no framework), Firebase 10.12.2 (ESM modules), html2pdf.js for PDF export

**Fonts:** Rajdhani (headings), Share Tech Mono (data/monospace), Nunito (body)

---

## Firebase / Firestore structure

All data is scoped under plants for multi-plant support:

```
plants/{plantId}                      ← plant metadata doc { name, location, createdAt, isActive }
  issues/{issueId}                    ← individual issue documents (v2 schema)
    events/{eventId}                  ← append-only event log subcollection
    attachments/{attachmentId}        ← photo attachment metadata subcollection
  config/statuses                     ← status category definitions
  config/presses                      ← press/row layout for this plant
  members/{userId}                    ← per-user role + permissions for this plant

users/{userId}/
  plantIds: ["plantId", ...]          ← IDs of plants the user can access (new structure)
  plants: [{id, name, location}]      ← legacy array (still read during migration window)
  lastPlant: "plantId"                ← last-used plant

userLookup/{email}                    ← global email→UID registry for member management
  uid, displayName, email, lastSeen
```

**Member document shape** (`plants/{plantId}/members/{userId}`):
```js
{
  userId: "firebase-uid",
  displayName: "James Scoggins",
  email: "james@example.com",
  role: "admin",           // "admin" | "editor" | "viewer"
  isActive: true,
  addedAt: serverTimestamp(),
  permissions: {
    canViewPlant: true,
    canCreateIssue: true,
    canEditIssue: true,
    canResolveIssue: true,
    canManageStatuses: true,  // controls admin panel visibility
    canManagePresses: true,
    canExport: true
  }
}
```

**Firebase Storage path:** `plants/{plantId}/issues/{issueId}/photos/{fileName}`

**Firestore path helpers** (defined in JS):
- `plantCol(colName)` → `collection(db, 'plants', currentPlantId, colName)`
- `plantDoc(colName, docId)` → `doc(db, 'plants', currentPlantId, colName, docId)`
- `issueEventsCol(issueId)` → events subcollection for an issue
- `issueAttachmentsCol(issueId)` → attachments subcollection for an issue

**Issue document shape (v2 schema):**
```js
{
  schemaVersion: 2,
  plantId: "default",
  pressId: "press_5_10",       // toPressId(machineCode)
  machineCode: "5.10",
  rowId: "row_05",             // toRowId(rowName)
  machine: "5.10",             // legacy compat field
  note: "Robot crashed",
  photoCount: 2,               // count only; actual photos in attachments subcollection
  photos: [{ name, dataUrl }], // legacy inline photos (v1) or Storage URLs (v2)
  dateTime: "Mar 28, 2026 5:38 PM",
  dateKey: "2026-03-28",
  timestamp: 1711655880000,
  resolved: false,             // legacy compat field
  userId: "firebase-uid",
  userName: "James Scoggins",
  currentStatus: {             // v2: denormalized current status for fast queries
    statusKey, subStatusKey, label, subLabel, color,
    enteredAt, enteredDateTime, enteredBy: { uid, name }, notePreview
  },
  lifecycle: {                 // v2: open/resolved lifecycle tracking
    isOpen, isResolved, openedAt, resolvedAt, closedAt, reopenedCount
  },
  statusHistory: [             // legacy + v1 status timeline (still read for rendering)
    { status: "open", subStatus: "", note: "", dateTime: "...", by: "..." },
    { status: "maintenance", subStatus: "In Progress", note: "...", dateTime: "...", by: "..." }
  ],
  workflowState: "called",     // "called" | "accepted" | "in-progress" | "finished"
  updatedAt: serverTimestamp(),
  updatedBy: { uid, name },
  createdAt: serverTimestamp()
}
```

**Events subcollection shape** (`issues/{issueId}/events/{eventId}`):
```js
{
  type: "status_changed",
  eventAt: serverTimestamp(),
  actor: { uid, name },
  payload: { toStatusKey, toSubStatusKey, note },
  schemaVersion: 2
}
```

**Attachments subcollection shape** (`issues/{issueId}/attachments/{attachmentId}`):
```js
{
  type: "photo",
  fileName, contentType, storagePath, storageBucket,
  thumbnailPath: null,
  uploadedBy: { uid, name },
  uploadedAt: serverTimestamp(),
  sizeBytes, source: "storage",
  schemaVersion: 2
}
```

**Status config shape** (`STATUSES` object):
```js
{
  open:            { label, shortLabel, statLabel, icon, cssColor, swipeColor, floorCls, cls, subs: [...], order: 0 },
  alert:           { ... order: 1 },
  controlman:      { ... order: 2 },
  maintenance:     { ... order: 3 },
  materials:       { ... order: 4 },
  processengineer: { ... order: 5 },
  quality:         { ... order: 6 },
  startup:         { ... order: 7 },
  tooldie:         { ... order: 8 },
  resolved:        { ... order: 9 }
}
```

The `statLabel` field is used for stat pill display text. Built-in categories ship with manufacturing-specific sub-statuses (e.g., `maintenance` has sub-statuses like `'Hydraulic Leak / Pressure Drop'`, `'Heater Band / Thermocouple Failure'`, etc.).

Custom statuses can be added/edited/deleted via the admin portal (`admin.html`). They are stored in Firestore and synced to all users. The admin portal also has a "Reset to Defaults" button that restores the full built-in manufacturing category set.

---

## Architecture & key concepts

### Multi-plant system
- `currentPlantId` tracks the active plant
- Plant switcher dropdown in the header between logo and user pill
- `switchPlant(id)` tears down the current listener, loads new plant's press layout + status config + member role, rebuilds floor map, starts fresh Firestore listener
- `loadUserPlants()` reads the user's plant list — new structure reads `users/{userId}.plantIds` and fetches each `plants/{plantId}` doc for name/location; old structure (`plants` array) is auto-migrated on first load via `_migratePlantsToNewStructure()`
- `loadPlantPresses()` reads press layout from `plants/{plantId}/config/presses`
- First-time users get a "default" plant created automatically via `_initNewPlant()`
- `addNewPlant()` writes a plant doc + member doc (admin) + appends to `users/{uid}.plantIds`

### Role & permissions system
- `currentUserRole` (`"admin"` | `"editor"` | `"viewer"`) and `currentUserPermissions` are set by `loadCurrentMember(plantId)` on every plant load
- `loadCurrentMember()` reads `plants/{plantId}/members/{userId}`; defaults to admin if no doc found (backward compat during migration)
- `applyRoleUI()` shows/hides the "Admin Portal" button based on `currentUserRole === 'admin'`
- `DEFAULT_PERMISSIONS` is the full-access permission set used for admin/first-time users
- Security rules in `firestore.rules` enforce membership at the Firestore level

### Status system
- `STATUSES` object is the single source of truth, loaded from Firestore
- `getStatusDef(statusKey)` returns the status definition or `STATUS_FALLBACK` (a safe default with label `'Unknown'`) — use this instead of direct `STATUSES[key]` access to avoid undefined errors
- `getStatusColor(statusKey)`, `getStatusLabel(statusKey, mode)`, `getStatusSubs(statusKey)` are helper functions wrapping `getStatusDef`
- `rebuildDerivedStatus()` rebuilds `window._ALL_STATUSES` and `window._STATUS_ORDER`, and dynamically rebuilds stat pills and status filter dropdown
- `currentStatusKey(issue)` reads `issue.currentStatus.statusKey` (v2) or the last entry in `statusHistory` (v1 legacy) to get current status
- Status history is an append-only timeline on each issue — each entry has `{ status, subStatus, note, dateTime, by }`
- Colors for custom categories use inline styles (not CSS classes) so they work without hardcoded CSS
- `loadConfig()` automatically migrates old Firestore configs that are missing the newer built-in categories (`alert`, `materials`, `quality`) by overwriting with the full default set

### Serial number prompt
- `requiresSerialNumber(statusKey, sub)` defines which status+sub combos need a serial number
- Intercepted in both swipe sub-chip clicks and `commitAddEntry` (timeline form)
- Opens a modal, stores serial as `S/N: {value}` in the status entry note

### Photo storage (v2)
- New photos are uploaded to Firebase Storage via `uploadIssuePhotosToStorage(issueId, photos)`
- Each uploaded photo gets a `storagePath` and a Storage download URL (stored in `dataUrl` for backward-compatible rendering)
- Attachment metadata is written to the `attachments` subcollection via `queueAttachmentDocs(batch, issueId, photos)`
- On render, `hydrateIssuePhotosFromAttachments(issueList)` fetches Storage URLs from the attachments subcollection for issues with `photoCount > 0`
- A fallback storage bucket is tried if the primary bucket returns a permission error
- Photo data is cached in `attachmentPhotoCache` (Map keyed by issueId) to avoid repeated fetches

### Event log (v2)
- Status changes write an event document to the `events` subcollection via `queueIssueEvent(batch, issueId, type, payload)`
- New issues and `addStatusEntry` / `setSubStatus` no longer write to the `statusHistory` array on the issue doc — `events` subcollection is the canonical append-only source
- `updateStatusEntry` and `removeStatusEntry` still write `statusHistory` as an "editable timeline" override (events are immutable; these functions allow correcting display history)
- `getMutableStatusHistory(issue)` returns `statusHistory` if present, else falls back to in-memory `eventHistory`
- `hydrateIssueHistoryFromEvents(issueList)` fetches events for v2 issues and normalizes them into the `statusHistory` shape for rendering
- Events are cached in `issueEventHistoryCache` (Map keyed by issueId)
- Hydration uses a token pattern (`attachmentsHydrationToken`, `eventsHydrationToken`) so stale async results are discarded when switching plants

### Workflow state system
- Each issue has a `workflowState` field tracking where it is in the response pipeline
- States (in order): `'called'` → `'accepted'` → `'in-progress'` → `'finished'`
- **Auto-transitions:** new issues start as `'called'`; resolving an issue (via resolve modal or swipe) auto-sets `'finished'`
- **Workflow pill** in issue card header shows current state with colored badge (yellow=called, green=accepted, blue=in-progress, purple=finished); clicking cycles to the next state via `cycleWorkflowState(issueId)`
- **Horizontal timeline** inside expanded cards shows all 4 steps with blue active dot, green completed dots, and connecting lines
- State is stored on the issue doc and updated via `updateDoc(plantDoc('issues', id), { workflowState: nextState })`

### Member management
- Member management (add/remove/change roles) is handled in `admin.html`, not in `index.html`
- `userLookup/{email}` is written (fire-and-forget) every time a user signs in so their UID is discoverable by email when an admin adds them to a plant (this write still happens in `index.html`)
- `index.html` still reads the current user's own member doc via `loadCurrentMember(plantId)` to determine role and permissions on each plant load

### Press layout
- `PRESSES` object maps row names to arrays of machine IDs
- Loaded per-plant from Firestore (`plants/{plantId}/config/presses`)
- Falls back to `DEFAULT_PRESSES` if Firestore has no config
- `ALL_MACHINES` is a flat array derived from `PRESSES`

---

## File structure (within single HTML file)

### CSS (~560 lines)
- `:root` — dark mode color variables
- `body.light` — light mode overrides
- Layout: header, controls, floor map, issues section
- Components: stat pills, row tabs, press buttons (split-bar style), issue cards, swipe panels, modals, mini-cards, masonry layout, sort dropdown, plant switcher, breadcrumb bar, search box
- Workflow: `.workflow-pill` (colored state badge), `.workflow-timeline-horizontal` (4-step progress bar with dots and connectors)

### HTML (~360 lines)
- Login screen (Google OAuth)
- App shell: sync banner, header (logo, plant switcher, user pill), controls bar, filter drawer (with search input), floor map, issue log
- Modals: add issue, edit issue, resolve, reopen, export PDF, serial number
- Lightbox

### JavaScript (~3,830 lines)

**Initialization & auth**
- Firebase init (App, Firestore, Storage — including fallback storage bucket), Google auth, `onAuthStateChanged` handler
- `bootstrapSignedInSession` — loads plants → presses → config → starts listener
- `doSignOut` tears down listener before signing out

**v2 schema helpers**
- `toPressId(machineCode)` / `toRowId(rowName)` — canonical ID derivation
- `deriveLifecycle(statusKey, baseIssue, opts)` — builds `lifecycle` object
- `buildCurrentStatus(statusKey, subStatus, ...)` — builds `currentStatus` object
- `buildIssueV2Compat(...)` — assembles v2-compatible issue fields
- `queueIssueEvent(batch, issueId, type, payload)` — writes to events subcollection

**Photo & attachment helpers**
- `uploadIssuePhotosToStorage(issueId, photos)` — uploads base64 data URLs to Storage, returns array with Storage URLs
- `queueAttachmentDocs(batch, issueId, photos)` — writes attachment metadata to subcollection
- `fetchAttachmentPhotos(issueId)` — reads attachments subcollection, resolves Storage URLs
- `hydrateIssuePhotosFromAttachments(issueList)` — async, calls renderIssues when done

**Event history helpers**
- `fetchIssueEventHistory(issue)` — reads events subcollection ordered by `eventAt`
- `normalizeEventHistory(issue, events)` — converts event docs to `statusHistory` shape
- `hydrateIssueHistoryFromEvents(issueList)` — async, targets `schemaVersion === 2` issues

**Multi-plant**
- `loadUserPlants`, `loadPlantPresses`, `switchPlant`, `addNewPlant`, `promptAddPlant`
- Plant dropdown UI (`buildPlantDropdown`, `togglePlantDropdown`, `closePlantDropdown`)
- `switchPlant` clears both caches and increments hydration tokens before loading new plant

**Status system**
- `getStatusDef(key)` → returns `STATUSES[key]` or `STATUS_FALLBACK`
- `getStatusColor`, `getStatusLabel`, `getStatusSubs` — safe wrappers
- `alphaColor(color, alpha)` — canvas-based hex-to-rgba converter for inline dim backgrounds
- `loadConfig()` / `saveConfig()` / `rebuildDerivedStatus()` / `buildStatusFilterPills()`
- Auto-migration: if Firestore config is missing `alert`, `materials`, or `quality`, overwrites with defaults

**Floor map**
- `buildFloorMap` — populates machine filter dropdown, renders row tabs
- `renderRowTabs` — tab strip with pulsing dot for rows with issues
- `renderRowPanels` — row panels with status pills (clickable to expand mini-issue-list), press buttons (split-bar segments), mini-card area
- `handlePressClick` — split-action: clear press shows mini-card with Report/History, press with issues shows issue list in mini-card
- `closeMiniCard` — cancellable timeout to avoid stale clears
- Press mini-card builds inline below press buttons with toolbar footer (+ Add / History)

**Issue CRUD**
- `submitIssue` — uploads photos to Storage, writes v2 issue doc + events + attachments in a batch
- `openEditModal` / `saveEdit` — edit note, date/time, photos
- `openResolveModal` / `confirmResolve` — mark resolved with note
- `openReopenModal` / `confirmReopen` — reopen with history preservation and lifecycle increment

**Status history**
- `addStatusEntry` — appends to statusHistory array, syncs legacy fields, writes event doc
- `updateStatusEntry` — edits existing history entry (with dateTime support)
- `removeStatusEntry` — removes entry (cannot remove the only one)
- `commitAddEntry` / `commitEditEntry` — read from DOM, check serial number requirement
- Pending entry state tracked in `pendingEntry` object per issue

**Rendering**
- `renderIssues` — filters (period, machine, status, search text), sorts, builds issue cards with expanded state preservation
- Each card has: header (machine tag, note preview, status pill), expandable body (full note, photos, status timeline, action buttons)
- Swipe gesture system (touch + mouse) for status quick-actions
- Swipe primary buttons: Open, Resolved (tile style)
- Swipe secondary panel: category tiles + sub-status chips (modal style)
- Masonry layout via `layoutMasonry()` — absolute positioning with column height tracking

**Masonry**
- `layoutMasonry` — calculates columns based on container width (min 300px per column), positions cards absolutely into shortest column
- Skipped on mobile (≤480px)
- Called after: renderIssues, toggleCard, swipe open/close, window resize

**UI controls**
- Theme toggle (dark/light), persisted in localStorage
- Filter drawer with stat pills, machine filter, status filter, search input
- Sort dropdown (8 options) in both issue log header and filter drawer, synced
- Active Rows toggle — filters issue log to only show issues from expanded floor map rows
- Machine breadcrumb bar — shows "Showing: Press X.XX" with dismiss button
- Period toggle (Today, 24h, Week, Month, All, date picker)

**Export PDF**
- `openExportModal` — builds print-ready HTML from current filtered issues
- Each issue rendered as a card with full note, photos, timestamps, status timeline
- `downloadPDF` — uses html2pdf.js to generate and download

**Workflow state**
- `cycleWorkflowState(issueId)` — reads current `workflowState` (default `'called'`), advances to next in `['called','accepted','in-progress','finished']`, writes to Firestore
- Auto-set to `'called'` in `submitIssue`; auto-set to `'finished'` in `confirmResolve` and when swipe sets status to `'resolved'`

**Admin portal link**
- "Admin Portal" button in the user dropdown (visible to admins only) navigates to `admin.html`
- Member management and status configuration are handled entirely in `admin.html`

---

## Key patterns & gotchas

### Inline styles for custom categories
All status colors are applied via inline styles, not CSS classes. This is intentional — custom categories created via the admin panel don't have corresponding CSS classes. When rendering pills, press buttons, timeline dots, etc., always use `st.swipeColor || st.cssColor || st.color` to get the hex color and apply it inline.

### Expanded state preservation
`renderIssues()` captures which cards are expanded (`.issue-body.visible`) before clearing the DOM, then restores them via the `wasOpen` check. This means full re-renders don't collapse cards.

### Swipe guard for toggleCard
A `_swipeJustHappened` flag prevents `toggleCard` from firing after a swipe gesture. Also, if `openSwipeRow` is set (a card is swiped open), `toggleCard` is suppressed entirely.

### Masonry + swipe panel close
When the swipe secondary panel closes, its `max-height` transition is bypassed (`transition: none`, force reflow, restore) so masonry can measure the correct card height immediately. Without this, masonry measures the card while the panel is still collapsing, leaving a gap for the duration of the animation.

### Firestore real-time listener
`startListener()` sets up an `onSnapshot` listener on `plants/{plantId}/issues`. On error, it retries with exponential backoff (2s, 4s, 6s… up to 15s). The listener is torn down and restarted when switching plants.

### Legacy compatibility
Issues may have legacy fields (`status`, `subStatus`, `resolved`) from before the `statusHistory` array was introduced. `currentStatusKey(issue)` checks `currentStatus.statusKey` (v2) first, then `statusHistory`, then falls back to legacy `status` field. The v2 `buildIssueV2Compat` helper adds normalized `pressId`, `rowId`, `machineCode`, `currentStatus`, and `lifecycle` fields to every write while preserving legacy fields for read compatibility.

### Unknown status keys
If an issue references a status key that no longer exists in `STATUSES` (e.g., a custom category was deleted), `getStatusDef()` returns `STATUS_FALLBACK` (`{ label: 'Unknown', icon: '❔', swipeColor: '#6b7280', ... }`) so rendering always produces a safe fallback rather than undefined errors.

### Plant switch cache invalidation
`switchPlant()` clears both `attachmentPhotoCache` and `issueEventHistoryCache` and increments both hydration tokens (`attachmentsHydrationToken`, `eventsHydrationToken`) before loading the new plant. This prevents stale photo/event data from a prior plant from leaking into the new view.

---

## Common tasks

### Add a new built-in status category
Add it to the `STATUSES` object default (for new plants), then add it via the admin panel for existing plants. No CSS changes needed — everything uses inline styles.

### Change the press layout for a plant
Update `plants/{plantId}/config/presses` in Firestore. The `PRESSES` object shape is `{ "Row 1": ["1.01", "1.02", ...], "Row 2": [...] }`.

### Add a new serial number prompt trigger
Edit `requiresSerialNumber(statusKey, sub)` to add conditions. The function is checked in both the swipe sub-chip click handler and `commitAddEntry`.

### Modify the PDF export layout
Edit the `openExportModal` function — the `cardsHtml` variable builds each issue card as inline-styled HTML. The preview and download use the same HTML.

### Add a new sort option
1. Add an entry to `SORT_OPTIONS` array
2. Add the sort logic in `renderIssues` (after the existing sort if/else chain)
3. The sort dropdown and filter drawer select both rebuild from `SORT_OPTIONS`

### Change the workflow state for an issue
Call `cycleWorkflowState(issueId)` from the UI (bound to the workflow pill click). To add a new state, update the `WORKFLOW_STATES` order array and add a new entry to `workflowConfig` in the rendering section, plus a new `.workflow-pill.<state>` CSS class.

### Add a member to a plant
Use `admin.html` — the "Members" section on each plant card. The user must have signed in at least once so their `userLookup` entry exists.

---

## External dependencies

| Library | Version | CDN | Purpose |
|---------|---------|-----|---------|
| Firebase App | 10.12.2 | gstatic.com | Firebase core |
| Firebase Firestore | 10.12.2 | gstatic.com | Database |
| Firebase Auth | 10.12.2 | gstatic.com | Google sign-in |
| Firebase Storage | 10.12.2 | gstatic.com | Photo file storage |
| html2pdf.js | 0.10.1 | cdnjs.cloudflare.com | PDF export |
| Google Fonts | — | fonts.googleapis.com | Rajdhani, Share Tech Mono, Nunito |

---

## Companion tools & other files

- **admin.html** — Standalone admin portal (~750 lines). Features: create new plants (auto-generates slug ID), manage members per plant (add by email, change roles, remove), manage status config with JSON import/export, Reset to Defaults. Only accessible to users with at least one admin role. Shares the same Firebase project.
- **debug.html** — Developer utility page for inspecting Firestore data and running ad-hoc queries (~1,300 lines).
- **kitty.html** — Easter egg page. Not functional.
- **migrate-to-plants.html** — One-time migration tool that copies root-level `issues/` and `config/` into `plants/default/` structure
- **migration-plant-structure.html** — Migrates `users/{uid}.plants` array → `plants/{id}` docs + `plants/{id}/members/{uid}` subcollection + `users/{uid}.plantIds`. Run once after deploying the new `index.html`. Safe to re-run (all writes use merge).
- **copy-statuses.html** — Copies status config from `plants/default/` to other plant IDs (AP1–AP5)
- **scripts/backfill-issues-v2.mjs** — Node.js script to migrate issues to v2 schema
- **scripts/backfill-attachments-v2.mjs** — Node.js script to migrate attachments to v2 schema
- **scripts/cleanup-legacy-v1-fields.mjs** — Node.js script to remove old v1 fields after migration
- **wrangler.jsonc** — Cloudflare Workers deployment config; serves the repo as static assets via `assets.directory: "."`

---

## Firestore v2 migration docs
Read these before making schema-related changes:

- `docs/firestore-schema-v2.md`
- `docs/security-rules-v2.md`
- `docs/manage-access-flow.md` — per-plant member management design (owner/editor/viewer role matrix, write operations, UI guardrails)
- `firestore.indexes.json`
- `firestore.rules` — deployed security rules (member-based access control)

For implementation work, start from:
- `docs/codex-migration-prompt.txt`

---

## TODO


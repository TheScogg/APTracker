# AP Tracker — CLAUDE.md

## Project overview

AP Tracker is a single-file HTML/JS web application for tracking injection molding press issues across multiple manufacturing plants. It runs entirely client-side with Firebase (Firestore + Auth + Storage) as the backend. The app is used on the factory floor on phones, tablets, and desktop monitors.

**File:** `index.html` (~4,700 lines, single file containing all HTML, CSS, and JS)

**Stack:** Vanilla JS (no framework), Firebase 10.12.2 (ESM modules), html2pdf.js for PDF export

**Fonts:** Rajdhani (headings), Share Tech Mono (data/monospace), Nunito (body)

---

## Firebase / Firestore structure

All data is scoped under plants for multi-plant support:

```
plants/{plantId}/
  issues/{issueId}        ← individual issue documents
  config/statuses         ← status category definitions
  config/presses          ← press/row layout for this plant

users/{userId}/
  plants: [{id, name, location}]   ← which plants user can access
  lastPlant: "plantId"              ← last-used plant
```

**Firestore path helpers** (defined in JS):
- `plantCol(colName)` → `collection(db, 'plants', currentPlantId, colName)`
- `plantDoc(colName, docId)` → `doc(db, 'plants', currentPlantId, colName, docId)`

**Issue document shape:**
```js
{
  machine: "5.10",
  note: "Robot crashed",
  photos: [{ name, dataUrl }],
  dateTime: "Mar 28, 2026 5:38 PM",
  dateKey: "2026-03-28",
  timestamp: 1711655880000,
  resolved: false,
  resolveNote: "",
  resolveDateTime: "",
  resolvedBy: "",
  userId: "firebase-uid",
  userName: "James Scoggins",
  statusHistory: [
    { status: "open", subStatus: "", note: "", dateTime: "...", by: "..." },
    { status: "maintenance", subStatus: "In Progress", note: "S/N: SN-44821-A", dateTime: "...", by: "..." }
  ],
  createdAt: serverTimestamp()
}
```

**Status config shape** (`STATUSES` object):
```js
{
  open: { label, shortLabel, icon, cssColor, swipeColor, floorCls, cls, subs: [], order: 0 },
  maintenance: { label, shortLabel, icon, cssColor, swipeColor, floorCls, cls, subs: ['Called','In Progress','Finished'], order: 1 },
  // ... more statuses ...
  resolved: { ... order: 6 }
}
```

Custom statuses can be added/edited/deleted via the admin panel (user menu → Manage Statuses). They are stored in Firestore and synced to all users.

---

## Architecture & key concepts

### Multi-plant system
- `currentPlantId` tracks the active plant
- Plant switcher dropdown in the header between logo and user pill
- `switchPlant(id)` tears down the current listener, loads new plant's press layout + status config, rebuilds floor map, starts fresh Firestore listener
- `loadUserPlants()` reads the user's plant list from `users/{userId}`
- `loadPlantPresses()` reads press layout from `plants/{plantId}/config/presses`
- First-time users get a "default" plant created automatically

### Status system
- `STATUSES` object is the single source of truth, loaded from Firestore
- `rebuildDerivedStatus()` rebuilds `window._ALL_STATUSES` and `window._STATUS_ORDER`, and dynamically rebuilds stat pills and status filter dropdown
- `currentStatusKey(issue)` reads the last entry in `statusHistory` array to get current status
- Status history is an append-only timeline on each issue — each entry has `{ status, subStatus, note, dateTime, by }`
- Colors for custom categories use inline styles (not CSS classes) so they work without hardcoded CSS

### Serial number prompt
- `requiresSerialNumber(statusKey, sub)` defines which status+sub combos need a serial number
- Currently triggers for `materials` → `Needed`
- Intercepted in both swipe sub-chip clicks and `commitAddEntry` (timeline form)
- Opens a modal, stores serial as `S/N: {value}` in the status entry note

### Press layout
- `PRESSES` object maps row names to arrays of machine IDs
- Loaded per-plant from Firestore (`plants/{plantId}/config/presses`)
- Falls back to `DEFAULT_PRESSES` if Firestore has no config
- `ALL_MACHINES` is a flat array derived from `PRESSES`

---

## File structure (within single HTML file)

### CSS (~530 lines)
- `:root` — dark mode color variables
- `body.light` — light mode overrides
- Layout: header, controls, floor map, issues section
- Components: stat pills, row tabs, press buttons (split-bar style), issue cards, swipe panels, modals, mini-cards, masonry layout, sort dropdown, plant switcher, breadcrumb bar, admin panel

### HTML (~350 lines)
- Login screen (Google OAuth)
- App shell: sync banner, header (logo, plant switcher, user pill), controls bar, filter drawer, floor map, issue log
- Modals: add issue, edit issue, resolve, reopen, export PDF, serial number
- Lightbox, admin overlay

### JavaScript (~2,500 lines)

**Initialization & auth** (~100 lines)
- Firebase init, Google auth, `onAuthStateChanged` handler
- Loads plants → presses → config → starts listener

**Multi-plant** (~150 lines)
- `loadUserPlants`, `loadPlantPresses`, `switchPlant`, `addNewPlant`
- Plant dropdown UI

**Floor map** (~700 lines)
- `buildFloorMap` — populates machine filter dropdown, renders row tabs
- `renderRowTabs` — tab strip with pulsing dot for rows with issues
- `renderRowPanels` — row panels with status pills (clickable to expand mini-issue-list), press buttons (split-bar segments), mini-card area
- `handlePressClick` — split-action: clear press shows mini-card with Report/History, press with issues shows issue list in mini-card
- `closeMiniCard` — cancellable timeout to avoid stale clears
- Press mini-card builds inline below press buttons with toolbar footer (+ Add / History)

**Issue CRUD** (~250 lines)
- `submitIssue` — creates new issue doc with photos, category, date/time
- `openEditModal` / `saveEdit` — edit note, date/time, photos
- `openResolveModal` / `confirmResolve` — mark resolved with note
- `openReopenModal` / `confirmReopen` — reopen with history preservation

**Status history** (~200 lines)
- `addStatusEntry` — appends to statusHistory array, syncs legacy fields
- `updateStatusEntry` — edits existing history entry (with dateTime support)
- `removeStatusEntry` — removes entry (cannot remove the only one)
- `commitAddEntry` / `commitEditEntry` — read from DOM, check serial number requirement
- Pending entry state tracked in `pendingEntry` object per issue

**Rendering** (~600 lines)
- `renderIssues` — filters, sorts, builds issue cards with expanded state preservation
- Each card has: header (machine tag, note preview, status pill), expandable body (full note, photos, status timeline, action buttons)
- Swipe gesture system (touch + mouse) for status quick-actions
- Swipe primary buttons: Open, Resolved (tile style)
- Swipe secondary panel: category tiles + sub-status chips (modal style)
- Masonry layout via `layoutMasonry()` — absolute positioning with column height tracking

**Masonry** (~50 lines)
- `layoutMasonry` — calculates columns based on container width (min 300px per column), positions cards absolutely into shortest column
- Skipped on mobile (≤480px)
- Called after: renderIssues, toggleCard, swipe open/close, window resize

**UI controls** (~200 lines)
- Theme toggle (dark/light), persisted in localStorage
- Filter drawer with stat pills, machine filter, status filter
- Sort dropdown (8 options) in both issue log header and filter drawer, synced
- Active Rows toggle — filters issue log to only show issues from expanded floor map rows
- Machine breadcrumb bar — shows "Showing: Press X.XX" with dismiss button
- Period toggle (Today, 24h, Week, Month, All, date picker)

**Export PDF** (~130 lines)
- `openExportModal` — builds print-ready HTML from current filtered issues
- Each issue rendered as a card with full note, photos, timestamps, status timeline
- `downloadPDF` — uses html2pdf.js to generate and download

**Admin panel** (~250 lines)
- Edit existing status categories (label, icon, color, sub-statuses)
- Add new categories with icon picker (40 emoji) and color picker (20 colors)
- Delete categories (with confirmation)
- Preview pill while editing
- Save writes to Firestore, rebuilds derived status data

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
Issues may have legacy fields (`status`, `subStatus`, `resolved`) from before the `statusHistory` array was introduced. `currentStatusKey(issue)` checks `statusHistory` first, then falls back to legacy fields.

### "undefined" status pills
If an issue's `statusHistory` contains a status key that doesn't exist in the current `STATUSES` config (e.g., a custom category was deleted), the stat pills and rendering will show "undefined". This is a known issue — the fix is to make `updateStats` and rendering gracefully handle unknown keys with a fallback label/color.

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

---

## External dependencies

| Library | Version | CDN | Purpose |
|---------|---------|-----|---------|
| Firebase App | 10.12.2 | gstatic.com | Firebase core |
| Firebase Firestore | 10.12.2 | gstatic.com | Database |
| Firebase Auth | 10.12.2 | gstatic.com | Google sign-in |
| html2pdf.js | 0.10.1 | cdnjs.cloudflare.com | PDF export |
| Google Fonts | — | fonts.googleapis.com | Rajdhani, Share Tech Mono, Nunito |

---

## Companion tools

- **migrate-to-plants.html** — One-time migration tool that copies root-level `issues/` and `config/` into `plants/default/` structure
- **copy-statuses.html** — Copies status config from `plants/default/` to other plant IDs (AP1–AP5)

---

## Firestore v2 migration docs
Read these before making schema-related changes:

- `docs/firestore-schema-v2.md`
- `docs/security-rules-v2.md`
- `firestore.indexes.json`

For implementation work, start from:
- `docs/codex-migration-prompt.txt`

---

## TODO


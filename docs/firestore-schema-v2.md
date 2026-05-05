# Firestore Schema v2 for APTracker

This document defines the proposed Firestore v2 schema for APTracker. It is designed to preserve the current app behavior while improving queryability, audit history, reporting, permissions, and long-term maintainability.

## Goals

The v2 schema keeps the current strengths of APTracker:

- plant-scoped data
- fast floor-map reads
- append-only issue history
- custom per-plant statuses
- simple client-driven UI

It also addresses the main weaknesses of the current schema:

- large embedded `statusHistory` arrays
- photos stored directly in Firestore documents
- singleton config documents that are hard to evolve
- weak permissions model
- limited reporting support

## Proposed structure

```text
users/{userId}

plants/{plantId}
plants/{plantId}/members/{userId}
plants/{plantId}/rows/{rowId}
plants/{plantId}/presses/{pressId}
plants/{plantId}/statusDefinitions/{statusKey}
plants/{plantId}/issues/{issueId}
plants/{plantId}/issues/{issueId}/events/{eventId}
plants/{plantId}/issues/{issueId}/attachments/{attachmentId}
plants/{plantId}/pressNotes/{noteId}
plants/{plantId}/pressStats/{pressId}
plants/{plantId}/dailyStats/{dateKey}
```

---

## 1. Users

### `users/{userId}`

Keep this document lightweight and user-centric.

```json
{
  "displayName": "James Scoggins",
  "email": "james@example.com",
  "photoURL": "https://...",
  "defaultPlantId": "plant_jef",
  "recentPlantIds": ["plant_jef", "plant_lou"],
  "createdAt": "serverTimestamp",
  "updatedAt": "serverTimestamp",
  "schemaVersion": 2
}
```

### Notes

- Store identity and preferences here.
- Do not use this document as the source of truth for plant authorization.
- Plant access should be derived from `plants/{plantId}/members/{userId}`.

---

## 2. Plants

### `plants/{plantId}`

Plant metadata only.

```json
{
  "name": "Jeffersonville",
  "code": "JEF",
  "location": "Jeffersonville, IN",
  "timezone": "America/New_York",
  "isActive": true,
  "createdBy": "uid_123",
  "updatedBy": "uid_123",
  "createdAt": "serverTimestamp",
  "updatedAt": "serverTimestamp",
  "schemaVersion": 2
}
```

### Recommended IDs

Use stable IDs, not display names.

Examples:

```text
plant_jef
plant_clarksville
```

---

## 3. Memberships

### `plants/{plantId}/members/{userId}`

This becomes the source of truth for authorization and plant-specific roles.

```json
{
  "userId": "uid_123",
  "displayName": "James Scoggins",
  "email": "james@example.com",
  "role": "owner",
  "isActive": true,
  "permissions": {
    "canViewPlant": true,
    "canCreateIssue": true,
    "canEditIssue": true,
    "canResolveIssue": true,
    "canManageStatuses": true,
    "canManagePresses": true,
    "canExport": true
  },
  "joinedAt": "serverTimestamp",
  "lastSeenAt": "serverTimestamp"
}
```

### Recommended roles

- `owner`
- `editor`
- `viewer`

### Notes

- Security rules should rely on membership documents.
- This makes per-plant access control much cleaner.

---

## 4. Rows

### `plants/{plantId}/rows/{rowId}`

Rows should be normalized instead of embedded inside a singleton config document.

```json
{
  "name": "Row 1",
  "order": 1,
  "isActive": true,
  "createdAt": "serverTimestamp",
  "updatedAt": "serverTimestamp"
}
```

### Recommended IDs

```text
row_01
row_02
```

---

## 5. Presses

### `plants/{plantId}/presses/{pressId}`

```json
{
  "machineCode": "5.10",
  "displayName": "Press 5.10",
  "rowId": "row_05",
  "orderInRow": 10,
  "isActive": true,

  "type": "injection_molding",
  "manufacturer": "Arburg",
  "tonnage": 500,
  "assetTag": "PRESS-510",
  "serialNumber": "ARB-510-22",

  "notes": "",
  "createdAt": "serverTimestamp",
  "updatedAt": "serverTimestamp",
  "schemaVersion": 2
}
```

### Recommended IDs

Use stable IDs like:

```text
press_5_10
press_1_03
```

### Notes

This allows:

- querying presses by row
- attaching metadata per press
- updating a single press without rewriting a large config document

---

## 6. Status definitions

### `plants/{plantId}/statusDefinitions/{statusKey}`

Each status should be its own document.

```json
{
  "key": "maintenance",
  "label": "Maintenance",
  "shortLabel": "Maint",
  "icon": "🔧",
  "color": {
    "primary": "#4f46e5",
    "swipe": "#6366f1",
    "floor": "#4f46e5"
  },
  "order": 10,
  "isActive": true,
  "isSystem": false,
  "requiresSerialNumber": false,
  "closesIssue": false,
  "subStatuses": [
    {
      "key": "called",
      "label": "Called",
      "order": 1,
      "isActive": true
    },
    {
      "key": "in_progress",
      "label": "In Progress",
      "order": 2,
      "isActive": true
    },
    {
      "key": "finished",
      "label": "Finished",
      "order": 3,
      "isActive": true
    }
  ],
  "createdAt": "serverTimestamp",
  "updatedAt": "serverTimestamp"
}
```

### Important rule

Do not hard-delete statuses that have historical usage.

Instead, use:

```json
{
  "isActive": false
}
```

### Notes

This prevents historical issues from breaking if a status is retired.

---

## 7. Issues

### `plants/{plantId}/issues/{issueId}`

This is the main operational document used by the live UI.

```json
{
  "plantId": "plant_jef",
  "pressId": "press_5_10",
  "machineCode": "5.10",
  "rowId": "row_05",

  "title": "Robot crashed",
  "description": "Robot crashed during part removal",
  "note": "Robot crashed",
  "issueType": "machine_fault",

  "priority": "medium",
  "severity": "production_stop",

  "currentStatus": {
    "statusKey": "maintenance",
    "subStatusKey": "in_progress",
    "label": "Maintenance",
    "subLabel": "In Progress",
    "color": "#4f46e5",
    "enteredAt": "serverTimestamp",
    "enteredBy": {
      "uid": "uid_123",
      "name": "James Scoggins"
    }
  },

  "lifecycle": {
    "isOpen": true,
    "isResolved": false,
    "openedAt": "serverTimestamp",
    "resolvedAt": null,
    "closedAt": null,
    "reopenedCount": 0
  },

  "assignment": {
    "assignedTeam": "maintenance",
    "assignedUserId": null,
    "assignedUserName": null
  },

  "serialRequirement": {
    "required": false,
    "captured": false,
    "value": null
  },

  "reporting": {
    "dateKey": "2026-04-04",
    "weekKey": "2026-W14",
    "monthKey": "2026-04",
    "shiftKey": "A"
  },

  "photoCount": 2,
  "latestNotePreview": "Robot faulted at mold open",
  "tags": ["robot", "stoppage"],

  "createdBy": {
    "uid": "uid_123",
    "name": "James Scoggins"
  },
  "updatedBy": {
    "uid": "uid_123",
    "name": "James Scoggins"
  },

  "createdAt": "serverTimestamp",
  "updatedAt": "serverTimestamp",
  "schemaVersion": 2
}
```

### Notes

- This document should always store the current issue summary state.
- The UI should not need to scan timeline arrays to figure out the current status.
- Keep this document optimized for live operational reads.

---

## 8. Issue events

### `plants/{plantId}/issues/{issueId}/events/{eventId}`

This replaces embedded `statusHistory` with an append-only event log.

### Status changed

```json
{
  "type": "status_changed",
  "eventAt": "serverTimestamp",
  "actor": {
    "uid": "uid_123",
    "name": "James Scoggins"
  },
  "payload": {
    "fromStatusKey": "open",
    "fromSubStatusKey": null,
    "toStatusKey": "maintenance",
    "toSubStatusKey": "in_progress",
    "note": "S/N: SN-44821-A",
    "serialNumber": "SN-44821-A"
  }
}
```

### Note added

```json
{
  "type": "note_added",
  "eventAt": "serverTimestamp",
  "actor": {
    "uid": "uid_123",
    "name": "James Scoggins"
  },
  "payload": {
    "note": "Maintenance called"
  }
}
```

### Issue edited

```json
{
  "type": "issue_edited",
  "eventAt": "serverTimestamp",
  "actor": {
    "uid": "uid_123",
    "name": "James Scoggins"
  },
  "payload": {
    "fieldsChanged": ["note", "priority"]
  }
}
```

### Resolved

```json
{
  "type": "issue_resolved",
  "eventAt": "serverTimestamp",
  "actor": {
    "uid": "uid_123",
    "name": "James Scoggins"
  },
  "payload": {
    "resolutionNote": "Replaced sensor"
  }
}
```

### Reopened

```json
{
  "type": "issue_reopened",
  "eventAt": "serverTimestamp",
  "actor": {
    "uid": "uid_123",
    "name": "James Scoggins"
  },
  "payload": {
    "reason": "Issue returned during startup"
  }
}
```

### Notes

- Events should be append-only.
- The issue doc is the current-state record.
- The events subcollection is the audit trail.

---

## 9. Attachments

### `plants/{plantId}/issues/{issueId}/attachments/{attachmentId}`

Photos should move to Firebase Storage, with metadata stored in Firestore.

```json
{
  "type": "photo",
  "fileName": "robot_fault.jpg",
  "contentType": "image/jpeg",
  "storagePath": "plants/plant_jef/issues/issue_123/photos/photo_01.jpg",
  "thumbnailPath": "plants/plant_jef/issues/issue_123/photos/thumb_photo_01.jpg",
  "uploadedBy": {
    "uid": "uid_123",
    "name": "James Scoggins"
  },
  "uploadedAt": "serverTimestamp",
  "sizeBytes": 248392
}
```

### Notes

Do not store base64 image blobs or `dataUrl` strings inside Firestore documents long term.

---

## 10. Press stats

### `plants/{plantId}/pressStats/{pressId}`

These documents support the floor map and dashboard views.

```json
{
  "pressId": "press_5_10",
  "machineCode": "5.10",
  "rowId": "row_05",

  "openIssueCount": 3,
  "criticalIssueCount": 1,
  "hasProductionStop": true,

  "currentTopStatusKey": "maintenance",
  "lastIssueAt": "serverTimestamp",
  "updatedAt": "serverTimestamp"
}
```

### Notes

Use these for lightweight floor-map indicators instead of recomputing from all issue documents every time.

---

## 11. Daily stats

### `plants/{plantId}/dailyStats/{dateKey}`

```json
{
  "dateKey": "2026-04-04",
  "issuesOpened": 12,
  "issuesResolved": 9,
  "openIssueCountEndOfDay": 18,

  "byStatus": {
    "open": 4,
    "maintenance": 6,
    "materials": 2
  },

  "byRow": {
    "row_01": 3,
    "row_05": 7
  },

  "byPress": {
    "press_5_10": 3,
    "press_5_11": 1
  },

  "updatedAt": "serverTimestamp"
}
```

### Notes

This is optional at first, but useful for fast reporting and future analytics.

---

## Recommended indexes

### Issues

1. Open issues by newest first
- `lifecycle.isOpen ASC`
- `createdAt DESC`

2. Open issues by press
- `pressId ASC`
- `lifecycle.isOpen ASC`
- `createdAt DESC`

3. Open issues by row
- `rowId ASC`
- `lifecycle.isOpen ASC`
- `createdAt DESC`

4. Issues by current status
- `currentStatus.statusKey ASC`
- `createdAt DESC`

5. Issues by reporting month and status
- `reporting.monthKey ASC`
- `currentStatus.statusKey ASC`
- `createdAt DESC`

6. Issues by date key
- `reporting.dateKey ASC`
- `createdAt DESC`

### Events

1. Timeline per issue
- `eventAt ASC`

---

## Security model

The membership documents make rules much cleaner.

### Rule helpers

```js
function isSignedIn() {
  return request.auth != null;
}

function memberDoc(plantId) {
  return get(/databases/$(database)/documents/plants/$(plantId)/members/$(request.auth.uid));
}

function isPlantMember(plantId) {
  return isSignedIn()
    && memberDoc(plantId).data.isActive == true;
}

function hasPermission(plantId, perm) {
  return isPlantMember(plantId)
    && memberDoc(plantId).data.permissions[perm] == true;
}
```

### Collection access model

#### Plants
- read: plant members
- write: admin only

#### Members
- read: plant members
- write: admin only

#### Presses, rows, statusDefinitions
- read: plant members
- write: `canManagePresses` or `canManageStatuses`

#### Issues
- read: plant members
- create: `canCreateIssue`
- update: `canEditIssue`
- resolve or reopen: `canResolveIssue`

#### Events
- read: plant members
- create: same permission as issue update
- update/delete: ideally disallow

#### Attachments
- read: plant members
- create: `canEditIssue`
- delete: admin or uploader

#### Press stats and daily stats
- read: plant members
- write: admin or trusted backend only

---

## Validation rules to enforce

### Issues
- `pressId`, `machineCode`, and `rowId` are required
- `currentStatus.statusKey` must match a defined status
- `lifecycle.isOpen` and `lifecycle.isResolved` must remain logically consistent
- `schemaVersion == 2`

### Events
- append-only
- `type` must be from an allowed list
- `eventAt` required
- `actor.uid == request.auth.uid`

### Status definitions
- `key` should be immutable after creation
- `subStatuses[].key` should be stable
- retire statuses with `isActive: false`, not hard delete

---

## 8. Press notes

### `plants/{plantId}/pressNotes/{noteId}`

Press notes stay lightweight and append-only after creation. Photo attachments are resized client-side, stored in Firebase Storage, and referenced by metadata on the note document.

```json
{
  "pressId": "press_5_10",
  "machineCode": "5.10",
  "text": "Waiting on parts",
  "photoCount": 2,
  "photos": [
    {
      "name": "pressure-gauge.jpg",
      "dataUrl": "https://...",
      "url": "https://...",
      "storagePath": "plants/plant_jef/pressNotes/note_123/photos/1712345678_0.jpg",
      "storageBucket": "press-tracker-9d9c9.firebasestorage.app",
      "contentType": "image/jpeg",
      "sizeBytes": 183442,
      "source": "storage"
    }
  ],
  "createdBy": {
    "uid": "uid_123",
    "name": "James Scoggins"
  },
  "createdAt": "serverTimestamp",
  "schemaVersion": 2
}
```

### Notes

- Keep the note doc writable only at create time.
- Use the stored `photos[]` metadata to render thumbnails and lightbox views.
- Preserve the existing `pressId` and `machineCode` fields for fast per-press queries.

---

## Migration plan

### Phase 1: additive, no breaking changes

Add new fields and collections without removing the old ones.

Add:
- `rows`
- `presses`
- `statusDefinitions`
- `currentStatus`
- `lifecycle`
- `schemaVersion`

Keep:
- `config/statuses`
- `config/presses`
- `statusHistory`
- `photos.dataUrl`

### Phase 2: dual write

When status changes:
- append an event into `events`
- update `currentStatus`
- update `lifecycle`
- optionally continue writing legacy `statusHistory` temporarily

When photos are uploaded:
- store them in Firebase Storage
- create an `attachments` doc
- optionally continue supporting legacy reads during transition

### Phase 3: backfill

For each legacy issue:
- derive `currentStatus` from the last `statusHistory` entry
- derive `lifecycle`
- create `events` from historical status entries
- migrate photo blobs to Storage
- populate `pressId` and `rowId`

### Phase 4: cutover

Stop reading:
- `statusHistory` for live state
- `resolved`, `resolveNote`, `resolveDateTime`
- `photos[].dataUrl`
- `config/statuses`
- `config/presses`

---

## Current-to-v2 mapping

### Current shape

```json
{
  "machine": "5.10",
  "note": "Robot crashed",
  "photos": [{ "name": "x.jpg", "dataUrl": "..." }],
  "dateKey": "2026-03-28",
  "timestamp": 1711655880000,
  "resolved": false,
  "resolveNote": "",
  "resolveDateTime": "",
  "resolvedBy": "",
  "statusHistory": []
}
```

### V2 shape

```json
{
  "pressId": "press_5_10",
  "machineCode": "5.10",
  "description": "Robot crashed",
  "note": "Robot crashed",
  "reporting": {
    "dateKey": "2026-03-28"
  },
  "lifecycle": {
    "isOpen": true,
    "isResolved": false
  },
  "currentStatus": {
    "statusKey": "maintenance",
    "subStatusKey": "in_progress"
  },
  "photoCount": 1,
  "schemaVersion": 2
}
```

The timeline moves to:

```text
plants/{plantId}/issues/{issueId}/events/{eventId}
```

---

## Minimum viable upgrade

If the goal is the biggest payoff with the least disruption, do these first:

### Must do
- add `presses`
- add `statusDefinitions`
- add `currentStatus` and `lifecycle` to issue docs
- move new timeline writes into `events`
- move new photos to Storage

### Nice next
- add `members`
- add `pressStats`
- add `dailyStats`

---

## Recommended implementation order

1. Create collections: `members`, `rows`, `presses`, `statusDefinitions`
2. Update new issue creation to write v2 fields
3. Update status changes to write both `currentStatus` and `events`
4. Add Storage-backed photo uploads
5. Add a migration script for old issues
6. Switch UI reads to v2 fields
7. Remove legacy reads

---

## Source of truth principle

For APTracker, keep issue summary state denormalized on the main issue document.

That means:

- `issues/{issueId}` is the fast operational record
- `issues/{issueId}/events/*` is the audit trail

This is the right balance for a floor operations app where current state must be cheap to read.

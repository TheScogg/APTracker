# Press Wiki + Event Notes Design (Plant-Scoped)

## Goal
Create a press-centric knowledge surface that separates stable reference content from time-based floor observations.

This design uses two layers:
- `Press Wiki Page` for authoritative, slowly changing machine knowledge
- `Shift Notes / Event Notes` for fast observations, photos, and shift-specific context

That split keeps the reference page clean while preserving the operational history that matters on the floor.

## Why this shape fits AP Tracker
- The app already works best when the floor can scan quickly.
- Press knowledge tends to fall into two buckets: durable facts and transient events.
- A wiki-style page is ideal for temperatures, process variables, and special instructions.
- Event notes are better for "what happened on this shift" and "what changed today."

## Firestore data model

### Collections and paths
- `plants/{plantId}/presses/{pressId}/wikiPages/{pageId}`
- `plants/{plantId}/presses/{pressId}/wikiPages/{pageId}/revisions/{revisionId}`
- `plants/{plantId}/presses/{pressId}/wikiPages/{pageId}/attachments/{attachmentId}`
- `plants/{plantId}/pressNotes/{noteId}`

### Layer 1: Press Wiki Page

The press wiki page is the stable, canonical machine reference.

Recommended default page ids:
- `press-wiki`
- `setup-guide`
- `troubleshooting`

### `wikiPages/{pageId}` document
```json
{
  "title": "Press 12 - Injection Molder A",
  "slug": "press-wiki",
  "summary": "Primary operating reference for Press 12.",
  "tags": ["press", "setup", "process", "quality"],
  "isPinned": true,
  "isLocked": false,
  "visibility": "plant",
  "currentRevisionId": "rev_20260506_001",
  "photoCount": 4,
  "searchText": "press 12 injection molder setup temperatures mold pressure troubleshooting",
  "createdBy": "uid_123",
  "createdAt": "<serverTimestamp>",
  "updatedBy": "uid_789",
  "updatedAt": "<serverTimestamp>",
  "lastActivityAt": "<serverTimestamp>",
  "lastVerifiedAt": "<timestamp|null>",
  "lastVerifiedBy": "<uid|null>",
  "schemaVersion": 1
}
```

### `revisions/{revisionId}` document
```json
{
  "body": "# Overview\n\nThis press is used for...",
  "changeNote": "Added zone temperatures and startup notes.",
  "prevRevisionId": "rev_20260505_004",
  "editedBy": "uid_789",
  "editedAt": "<serverTimestamp>"
}
```

### `attachments/{attachmentId}` document
```json
{
  "storagePath": "plants/{plantId}/press-wiki/{pressId}/{pageId}/img_01.jpg",
  "contentType": "image/jpeg",
  "caption": "Control panel showing normal operating values",
  "linkedRevisionId": "rev_20260506_001",
  "uploadedBy": "uid_789",
  "uploadedAt": "<serverTimestamp>",
  "width": 1920,
  "height": 1080
}
```

### Layer 2: Shift Notes / Event Notes

Shift notes are quick entries tied to a press. They should stay lightweight and behave like an event log.

Recommended content:
- temperatures observed during the shift
- temporary process changes
- photos from the panel or part quality checks
- special instructions that were discovered or confirmed
- "what happened" notes that should not overwrite the canonical wiki page

### `pressNotes/{noteId}` document
```json
{
  "pressId": "press_5_10",
  "machineCode": "5.10",
  "noteType": "event",
  "text": "Zone 2 drifted high during warmup, then stabilized after a reset.",
  "photoCount": 2,
  "photos": [
    {
      "name": "pressure-gauge.jpg",
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

### Notes on the split
- The wiki page should be edited intentionally.
- The event note stream should stay fast and low-friction.
- Important event notes can be promoted into the wiki page later.
- The wiki page should not become a rolling chat log.

## Press page template

### Recommended sections
- Overview
- Standard Setup
- Running Parameters
- Special Instructions
- Photos
- Troubleshooting
- History

### Press page fields
- `pressId`
- `title`
- `summary`
- `pressType`
- `productFamilies`
- `status`
- `standardSetup`
- `specialInstructions`
- `photos`
- `relatedRefs`
- `tags`
- `lastVerifiedAt`
- `verifiedBy`
- `updatedAt`
- `revisionCount`

### Example setup fields
```json
{
  "standardSetup": {
    "zoneTemps": {
      "zone1": 350,
      "zone2": 360,
      "zone3": 365,
      "zone4": 370,
      "nozzle": 375
    },
    "moldTemp": 180,
    "clampTonnage": 110,
    "screwSpeed": 65,
    "backPressure": 8,
    "holdPressure": 900,
    "cycleTime": 42,
    "drying": {
      "temp": 160,
      "timeHours": 4
    }
  }
}
```

## UI wireframe

### Desktop / tablet layout
```text
-------------------------------------------------------------
| Press 12 - Injection Molder A          [Edit] [Add Note]  |
| Active | Line 4 | Last verified: May 6                   |
-------------------------------------------------------------
| Summary                                                   |
| Short reference paragraph about the press.               |
-------------------------------------------------------------
| Contents                  | Related / Recent Events       |
| - Overview                | - 7:42 AM Zone 2 overshot     |
| - Standard Setup          | - Yesterday startup delay     |
| - Special Instructions     | - Related issue: Short shots  |
| - Photos                  |                               |
| - Troubleshooting         |                               |
| - History                 |                               |
-------------------------------------------------------------
| Overview                                                  |
| Standard Setup                                            |
| Special Instructions                                      |
| Photos                                                    |
| Troubleshooting                                           |
| History                                                   |
-------------------------------------------------------------
```

### Mobile layout
```text
------------------------------------------------
| Press 12 - Injection Molder A                |
| Active | Verified | [Add Note]               |
------------------------------------------------
| Summary                                       |
------------------------------------------------
| Jump to... [Contents dropdown]                |
------------------------------------------------
| Overview                                      |
| Standard Setup                                |
| Special Instructions                          |
| Photos                                        |
| Troubleshooting                               |
| History                                       |
------------------------------------------------
| Recent Notes                                  |
| - Shift note from 7:42 AM                     |
| - Photo added this morning                    |
| - Last issue linked                            |
------------------------------------------------
```

### Interaction model
- `Edit Press Page` changes the wiki page only.
- `Add Note` creates an event note.
- `Add Photo` can attach to either layer depending on intent.
- `Link Issue` ties a note to a tracked problem.
- `Mark Verified` updates the press page trust state.

## Revision workflow
1. Read the current wiki page.
2. Create a new revision document.
3. Update the page doc with the new `currentRevisionId`.
4. Refresh `updatedAt`, `updatedBy`, and `lastActivityAt`.
5. If there is a conflict, prompt the user to reload and merge.

## Suggested XP hooks
- `wiki_create_page:{plantId}:{pressId}:{pageId}`
- `wiki_add_revision:{plantId}:{pageId}:{revisionId}`
- `wiki_add_photo:{plantId}:{pageId}:{attachmentId}`
- `press_note_create:{plantId}:{pressId}:{noteId}`

## Rollout plan
- **Phase 1:** wiki page CRUD, event notes, attachments, basic role checks.
- **Phase 2:** pin/lock moderation, revision history, templates.
- **Phase 3:** review prompts, stale-page reminders, contribution rewards.

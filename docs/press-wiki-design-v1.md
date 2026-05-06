# Press Wiki v1 Design (Plant-Scoped)

## Goals
- Add per-press wiki-style documentation with collaborative text and photos.
- Preserve AP Tracker's plant-scoped, role-aware, append-only history patterns.
- Integrate with existing gamification (XP, missions, badges) for contribution incentives.

## Firestore data model

### Collections and paths
- `plants/{plantId}/presses/{pressId}/wikiPages/{pageId}`
- `plants/{plantId}/presses/{pressId}/wikiPages/{pageId}/revisions/{revisionId}`
- `plants/{plantId}/presses/{pressId}/wikiPages/{pageId}/attachments/{attachmentId}`

### `wikiPages/{pageId}` document
```json
{
  "title": "Common Sensor Faults",
  "slug": "common-sensor-faults",
  "summary": "Quick fixes for top 5 recurring sensor alarms.",
  "tags": ["sensor", "alarms", "troubleshooting"],
  "isPinned": true,
  "isLocked": false,
  "visibility": "plant",
  "currentRevisionId": "rev_20260506_001",
  "photoCount": 3,
  "searchText": "common sensor faults alarms troubleshooting quick fixes",
  "createdBy": "uid_123",
  "createdAt": "<serverTimestamp>",
  "updatedBy": "uid_789",
  "updatedAt": "<serverTimestamp>",
  "lastActivityAt": "<serverTimestamp>",
  "lastVerifiedAt": "<timestamp|null>",
  "lastVerifiedBy": "<uid|null>"
}
```

### `revisions/{revisionId}` document (append-only)
```json
{
  "body": "## Alarm 12: Photoeye blocked\n1. Inspect bracket...",
  "changeNote": "Added reset sequence and part number note.",
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
  "caption": "Sensor mount orientation (correct)",
  "linkedRevisionId": "rev_20260506_001",
  "uploadedBy": "uid_789",
  "uploadedAt": "<serverTimestamp>",
  "width": 1920,
  "height": 1080
}
```

## Storage path convention
- `plants/{plantId}/press-wiki/{pressId}/{pageId}/{attachmentId}-{filename}`

This keeps tenant isolation aligned with existing issue attachment strategy.

## Security rules snippet (Firestore)
Use member-role checks from existing plant membership docs.

```rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() {
      return request.auth != null;
    }

    function isPlantMember(plantId) {
      return signedIn()
        && exists(/databases/$(database)/documents/plants/$(plantId)/members/$(request.auth.uid));
    }

    function memberRole(plantId) {
      return get(/databases/$(database)/documents/plants/$(plantId)/members/$(request.auth.uid)).data.role;
    }

    function canEditWiki(plantId) {
      return isPlantMember(plantId)
        && memberRole(plantId) in ['admin', 'lead', 'operator'];
    }

    function canModerateWiki(plantId) {
      return isPlantMember(plantId)
        && memberRole(plantId) in ['admin', 'lead'];
    }

    match /plants/{plantId}/presses/{pressId}/wikiPages/{pageId} {
      allow read: if isPlantMember(plantId);
      allow create: if canEditWiki(plantId);
      allow update: if canEditWiki(plantId)
        && (!('isLocked' in request.resource.data) || canModerateWiki(plantId))
        && (!('isPinned' in request.resource.data) || canModerateWiki(plantId));
      allow delete: if false; // archive instead of delete

      match /revisions/{revisionId} {
        allow read: if isPlantMember(plantId);
        allow create: if canEditWiki(plantId);
        allow update, delete: if false; // append-only history
      }

      match /attachments/{attachmentId} {
        allow read: if isPlantMember(plantId);
        allow create: if canEditWiki(plantId);
        allow update: if canEditWiki(plantId);
        allow delete: if canModerateWiki(plantId);
      }
    }
  }
}
```

## UI wireframe flow (index.html)

### Press Detail: new `Wiki` tab
1. **List mode**
   - Header: `Wiki`, `+ New Page`, search input
   - Sections: `Pinned`, `Recently Updated`
   - Card fields: title, summary, tags, updatedBy/updatedAt, photo badge

2. **Reader mode**
   - Title row: page title, lock/pin icons, `Edit` button
   - Metadata row: last updated, last verified
   - Body region: rendered markdown-lite text
   - Attachment strip/gallery with captions
   - Activity drawer: revision history and change notes

3. **Editor mode**
   - Inputs: title, tags, body, required `changeNote`
   - Photo upload picker and caption field
   - Save action:
     - create new `revisions/{revisionId}`
     - transactionally update `wikiPages.currentRevisionId`, `updatedAt`, `updatedBy`, `lastActivityAt`

### Tablet-first interaction details
- Keep one-hand actions in bottom sticky bar: `Save`, `Add Photo`, `Cancel`.
- Use large touch targets for page cards and image thumbnails.
- Preserve scroll position when returning from reader -> list.

## Revision algorithm
1. Read current `wikiPages` doc.
2. Create new revision doc with `prevRevisionId = currentRevisionId`.
3. Update page doc with new `currentRevisionId`, summary/searchText refresh, audit fields.
4. On conflict (`updatedAt` changed), prompt user to reload and merge.

## Gamification hooks
Suggested XP events:
- `wiki_create_page:{plantId}:{pressId}:{pageId}`
- `wiki_add_revision:{plantId}:{pageId}:{revisionId}`
- `wiki_add_photo:{plantId}:{pageId}:{attachmentId}`

Suggested mission examples:
- `Document 3 press fixes this week`
- `Add 2 pages with at least one photo`

## Rollout plan
- **Phase 1 (MVP):** list/read/edit pages, revisions, attachments, basic role checks.
- **Phase 2:** pin/lock moderation, revision viewer/revert workflow, templates.
- **Phase 3:** contribution leaderboard tie-in and stale-page prompts.

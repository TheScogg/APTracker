# Firestore Security Rules v2 for APTracker

This document defines a practical security model for the APTracker Firestore v2 schema.

The design assumes:

- each plant is a tenancy boundary
- each user must be an active member of a plant to access plant data
- permissions are stored on `plants/{plantId}/members/{userId}`
- issue timeline events are append-only
- reporting documents are written only by trusted owners or backend code

## Goals

- keep plant data isolated
- allow fine-grained permissions without overcomplicating rules
- make reads simple for the live floor map
- protect audit history from mutation
- prepare for future Cloud Functions or server-side aggregation

---

## Membership model

Membership documents live at:

```text
plants/{plantId}/members/{userId}
```

Example:

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
  }
}
```

This document is the source of truth for plant access.

---

## Recommended rule helpers

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() {
      return request.auth != null;
    }

    function currentUid() {
      return request.auth.uid;
    }

    function memberPath(plantId) {
      return /databases/$(database)/documents/plants/$(plantId)/members/$(currentUid());
    }

    function memberDoc(plantId) {
      return get(memberPath(plantId));
    }

    function isPlantMember(plantId) {
      return signedIn()
        && exists(memberPath(plantId))
        && memberDoc(plantId).data.isActive == true;
    }

    function hasPermission(plantId, perm) {
      return isPlantMember(plantId)
        && memberDoc(plantId).data.permissions[perm] == true;
    }

    function isPlantOwner(plantId) {
      return isPlantMember(plantId)
        && memberDoc(plantId).data.role == "owner";
    }

    function isSelf(userId) {
      return signedIn() && currentUid() == userId;
    }
  }
}
```

---

## Recommended access model by collection

### `users/{userId}`

#### Read
- the user themself

#### Write
- the user themself

#### Reasoning
This document stores profile and plant preference data, not plant authorization.

For shared wiki pages, the app also uses the user's `users/{uid}.plantIds` routing list as a plant-access fallback, so shared-library content can be written by any user who is already routed into that plant even if their member doc has not fully synced yet.

---

### `plants/{plantId}`

#### Read
- active plant members

#### Write
- plant owners + editors

#### Reasoning
Plant metadata should not be editable by general operators.

---

### `plants/{plantId}/members/{userId}`

#### Read
- active plant members

#### Write
- plant owners only

#### Optional exception
Allow a user to update only their own `lastSeenAt` if you want client-driven presence tracking.

---

### `plants/{plantId}/rows/{rowId}`

#### Read
- active plant members

#### Write
- users with `canManagePresses`

---

### `plants/{plantId}/presses/{pressId}`

#### Read
- active plant members

#### Write
- users with `canManagePresses`

---

### `plants/{plantId}/statusDefinitions/{statusKey}`

#### Read
- active plant members

#### Write
- users with `canManageStatuses`

#### Important
Allow updates that set `isActive = false`, but avoid hard deletes in app logic.

---

### `plants/{plantId}/issues/{issueId}`

#### Read
- active plant members

#### Create
- users with `canCreateIssue`

#### Update
- users with `canEditIssue`

#### Resolve / reopen
- users with `canResolveIssue`

#### Important
The easiest practical approach is:
- allow issue creation to `canCreateIssue`
- allow general updates to `canEditIssue`
- enforce resolve/reopen distinctions in app code at first
- tighten later with more granular rule checks if needed

---

### `plants/{plantId}/issues/{issueId}/events/{eventId}`

#### Read
- active plant members

#### Create
- users with `canEditIssue`

#### Update
- deny

#### Delete
- deny

#### Reasoning
Events are the audit trail and should be append-only.

---

### `plants/{plantId}/issues/{issueId}/attachments/{attachmentId}`

#### Read
- active plant members

#### Create
- users with `canEditIssue`

#### Update
- uploader or owner

#### Delete
- uploader or owner

---

### `plants/{plantId}/pressStats/{pressId}`

#### Read
- active plant members

#### Write
- owner only or backend only

---

### `plants/{plantId}/dailyStats/{dateKey}`

#### Read
- active plant members

#### Write
- owner only or backend only

---

### `plants/{plantId}/presses/{pressId}/wikiPages/{pageId}`

#### Read
- active plant members

#### Create / update
- users with `canManagePresses` or a dedicated wiki-edit permission in app logic

#### Delete
- owner only

#### Reasoning
This is the durable press reference layer and should be editable by trusted press owners, leads, or editors.

---

### `plants/{plantId}/presses/{pressId}/wikiPages/{pageId}/revisions/{revisionId}`

#### Read
- active plant members

#### Create
- same permission as wiki page edits

#### Update / delete
- deny

#### Reasoning
Revisions are append-only history.

---

### `plants/{plantId}/presses/{pressId}/wikiPages/{pageId}/attachments/{attachmentId}`

#### Read
- active plant members

#### Create / update
- same permission as wiki page edits

#### Delete
- owner only

---

### `plants/{plantId}/wikiPages/{pageId}`

#### Read
- active plant members

#### Create / update
- same permission as press wiki pages

#### Delete
- owner only

#### Reasoning
This is the plant-wide shared wiki library and should use the same editor, revision, and attachment rules as the press-scoped wiki.

---

### `plants/{plantId}/wikiPages/{pageId}/revisions/{revisionId}`

#### Read
- active plant members

#### Create
- same permission as wiki page edits

#### Update / delete
- deny

#### Reasoning
Shared library revisions are append-only history.

---

### `plants/{plantId}/wikiPages/{pageId}/attachments/{attachmentId}`

#### Read
- active plant members

#### Create / update
- same permission as wiki page edits

#### Delete
- owner only

---

### `plants/{plantId}/pressNotes/{noteId}`

#### Read
- active plant members

#### Create
- users with `canEditIssue` or similar plant-floor write permission

#### Update / delete
- deny

#### Reasoning
These are lightweight event notes and should remain append-only.

---

## Starter rules file

This is a practical baseline, not the final perfect version.

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() {
      return request.auth != null;
    }

    function currentUid() {
      return request.auth.uid;
    }

    function memberPath(plantId) {
      return /databases/$(database)/documents/plants/$(plantId)/members/$(currentUid());
    }

    function memberDoc(plantId) {
      return get(memberPath(plantId));
    }

    function isPlantMember(plantId) {
      return signedIn()
        && exists(memberPath(plantId))
        && memberDoc(plantId).data.isActive == true;
    }

    function hasPermission(plantId, perm) {
      return isPlantMember(plantId)
        && memberDoc(plantId).data.permissions[perm] == true;
    }

    function isPlantOwner(plantId) {
      return isPlantMember(plantId)
        && memberDoc(plantId).data.role == "owner";
    }

    function isSelf(userId) {
      return signedIn() && currentUid() == userId;
    }

    match /users/{userId} {
      allow read, write: if isSelf(userId);
    }

    match /plants/{plantId} {
      allow read: if isPlantMember(plantId);
      allow create, update, delete: if isPlantOwner(plantId);

      match /members/{userId} {
        allow read: if isPlantMember(plantId);
        allow create, update, delete: if isPlantOwner(plantId);
      }

      match /rows/{rowId} {
        allow read: if isPlantMember(plantId);
        allow create, update, delete: if hasPermission(plantId, "canManagePresses");
      }

      match /presses/{pressId} {
        allow read: if isPlantMember(plantId);
        allow create, update, delete: if hasPermission(plantId, "canManagePresses");
      }

      match /statusDefinitions/{statusKey} {
        allow read: if isPlantMember(plantId);
        allow create, update, delete: if hasPermission(plantId, "canManageStatuses");
      }

      match /issues/{issueId} {
        allow read: if isPlantMember(plantId);
        allow create: if hasPermission(plantId, "canCreateIssue");
        allow update: if hasPermission(plantId, "canEditIssue");
        allow delete: if isPlantOwner(plantId);

        match /events/{eventId} {
          allow read: if isPlantMember(plantId);
          allow create: if hasPermission(plantId, "canEditIssue");
          allow update, delete: if false;
        }

        match /attachments/{attachmentId} {
          allow read: if isPlantMember(plantId);
          allow create: if hasPermission(plantId, "canEditIssue");
          allow update, delete: if isPlantOwner(plantId);
        }
      }

      match /pressStats/{pressId} {
        allow read: if isPlantMember(plantId);
        allow write: if isPlantOwner(plantId);
      }

      match /dailyStats/{dateKey} {
        allow read: if isPlantMember(plantId);
        allow write: if isPlantOwner(plantId);
      }
    }
  }
}
```

---

## Recommended validation checks

Rules should stay reasonably simple. Use app logic for most shape validation, but enforce these important constraints where possible.

### Users
- user may only write their own document

### Memberships
- only owners can change roles or permissions
- app should avoid allowing members to self-escalate

### Issues
- require `schemaVersion == 2`
- require non-empty `pressId`
- require non-empty `machineCode`
- require non-empty `rowId`
- require `plantId` to match path plantId
- require `currentStatus.statusKey` to be present
- require `lifecycle.isOpen` and `lifecycle.isResolved` to be consistent

### Events
- deny update/delete
- require `type`
- require `actor.uid == request.auth.uid`

### Status definitions
- keep `key` stable after creation
- prefer `isActive = false` over deletes

### Press wiki pages
- keep `slug` stable after creation
- keep revisions append-only
- use `lastVerifiedAt` and `lastVerifiedBy` for trusted reference content

### Press notes
- keep event notes lightweight
- avoid rewriting old entries in place
- store photo metadata in Firestore and binaries in Storage

---

## Practical guidance

### Best first step
Use the starter rules above first. Do not try to encode every business rule in Firestore rules on day one.

### Good split of responsibility
- Firestore rules: membership and high-level authorization
- app code: business workflow and detailed transitions
- backend or owner tools: reporting aggregates

### Future tightening
Once the v2 schema is live, you can tighten rules to distinguish:
- general edits vs resolve/reopen
- attachment delete by uploader
- self-only membership heartbeat updates

---

## Suggested next follow-up

After adopting this document, the next useful artifact is a real `firestore.rules` file tailored to the current APTracker code paths.

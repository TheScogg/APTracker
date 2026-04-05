# Firestore Security Rules v2 for APTracker

This document defines a practical security model for the APTracker Firestore v2 schema.

The design assumes:

- each plant is a tenancy boundary
- each user must be an active member of a plant to access plant data
- permissions are stored on `plants/{plantId}/members/{userId}`
- issue timeline events are append-only
- reporting documents are written only by trusted admins or backend code

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
  "role": "admin",
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

    function isPlantAdmin(plantId) {
      return isPlantMember(plantId)
        && memberDoc(plantId).data.role == "admin";
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

---

### `plants/{plantId}`

#### Read
- active plant members

#### Write
- plant admins only

#### Reasoning
Plant metadata should not be editable by general operators.

---

### `plants/{plantId}/members/{userId}`

#### Read
- active plant members

#### Write
- plant admins only

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
- uploader or admin

#### Delete
- uploader or admin

---

### `plants/{plantId}/pressStats/{pressId}`

#### Read
- active plant members

#### Write
- admin only or backend only

---

### `plants/{plantId}/dailyStats/{dateKey}`

#### Read
- active plant members

#### Write
- admin only or backend only

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

    function isPlantAdmin(plantId) {
      return isPlantMember(plantId)
        && memberDoc(plantId).data.role == "admin";
    }

    function isSelf(userId) {
      return signedIn() && currentUid() == userId;
    }

    match /users/{userId} {
      allow read, write: if isSelf(userId);
    }

    match /plants/{plantId} {
      allow read: if isPlantMember(plantId);
      allow create, update, delete: if isPlantAdmin(plantId);

      match /members/{userId} {
        allow read: if isPlantMember(plantId);
        allow create, update, delete: if isPlantAdmin(plantId);
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
        allow delete: if isPlantAdmin(plantId);

        match /events/{eventId} {
          allow read: if isPlantMember(plantId);
          allow create: if hasPermission(plantId, "canEditIssue");
          allow update, delete: if false;
        }

        match /attachments/{attachmentId} {
          allow read: if isPlantMember(plantId);
          allow create: if hasPermission(plantId, "canEditIssue");
          allow update, delete: if isPlantAdmin(plantId);
        }
      }

      match /pressStats/{pressId} {
        allow read: if isPlantMember(plantId);
        allow write: if isPlantAdmin(plantId);
      }

      match /dailyStats/{dateKey} {
        allow read: if isPlantMember(plantId);
        allow write: if isPlantAdmin(plantId);
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
- only admins can change roles or permissions
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

---

## Practical guidance

### Best first step
Use the starter rules above first. Do not try to encode every business rule in Firestore rules on day one.

### Good split of responsibility
- Firestore rules: membership and high-level authorization
- app code: business workflow and detailed transitions
- backend or admin tools: reporting aggregates

### Future tightening
Once the v2 schema is live, you can tighten rules to distinguish:
- general edits vs resolve/reopen
- attachment delete by uploader
- self-only membership heartbeat updates

---

## Suggested next follow-up

After adopting this document, the next useful artifact is a real `firestore.rules` file tailored to the current APTracker code paths.

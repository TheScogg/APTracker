# Per-Plant Access Management Flow

This is the concrete implementation plan for user assignment + permissions in Firestore.

## 1) Firestore data model

### Plant document

`plants/{plantId}` stores plant metadata only.

```json
{
  "name": "Jeffersonville",
  "code": "JEF",
  "createdBy": "uid_owner",
  "createdAt": "serverTimestamp",
  "updatedAt": "serverTimestamp"
}
```

### Membership document (source of truth)

`plants/{plantId}/members/{uid}` stores access and role per user.

```json
{
  "uid": "uid_editor",
  "email": "editor@example.com",
  "displayName": "Line Lead",
  "role": "editor",
  "status": "active",
  "addedBy": "uid_owner",
  "addedAt": "serverTimestamp",
  "updatedAt": "serverTimestamp"
}
```

### Optional user-facing index (denormalized)

Use this only if you need very fast "my plants" reads in the UI.

`users/{uid}/plantMemberships/{plantId}`

```json
{
  "plantId": "plant_jef",
  "plantName": "Jeffersonville",
  "role": "editor",
  "status": "active",
  "updatedAt": "serverTimestamp"
}
```

## 2) Role matrix

Keep this intentionally simple at first:

- `owner`: full control, can add/remove users and change roles, can delete plant.
- `editor`: can update plant content (issues/config), cannot manage members.
- `viewer`: read-only.

If you need fine-grained permissions later, add a `permissions` map after this baseline is stable.

## 3) Recommended UI: per-plant "Manage Access" screen

Start with per-plant management instead of a global assignment page.

### Screen sections

1. **Members list**
   - Display name/email
   - Current role badge
   - Status (active/revoked)

2. **Invite/Add user**
   - Input: user email (or UID for internal-only first version)
   - Role picker: owner / editor / viewer
   - Action: add member

3. **Role controls**
   - Change role for existing member
   - Revoke access (set `status = "revoked"` instead of hard delete for audit clarity)

### Guardrails in UI

- Owner cannot demote/remove the last remaining owner.
- Editors can view member list but cannot modify it.
- Show a clear confirmation modal for ownership transfer and revoke actions.

## 4) Write operations

### Add member

- Upsert `plants/{plantId}/members/{uid}` with role + metadata.
- Optionally upsert `users/{uid}/plantMemberships/{plantId}`.

### Change role

- Update membership `role`.
- Update denormalized `users/{uid}/plantMemberships/{plantId}.role` if used.

### Revoke access

- Set `status = "revoked"` on member doc.
- Keep document for auditability.

## 5) Security rule expectations

- Any plant read requires active membership.
- Member management (`members/*` write) is owner-only.
- Plant content write is owner/editor.
- Viewer is read-only.

The repository `firestore.rules` has been aligned with this owner/editor/viewer baseline.

## 6) Recommended rollout order

1. Deploy security rules + membership docs.
2. Add Manage Access page under plant settings.
3. Backfill existing users into `members` docs.
4. Add optional `users/*/plantMemberships/*` index only if list performance requires it.
5. Add invitation emails/cloud functions later.

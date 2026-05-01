# Role-Based Alert Feeds (v1)

This document defines how users select job feeds and how issue status updates auto-route alerts.

## User job selection

Users are assigned to role keys on their plant member document:

- Path: `plants/{plantId}/members/{uid}`
- Preferred field: `jobRoleKeys: string[]`
- Legacy-compatible field: `jobFeeds: string[]` (still read as fallback)

Example:

```json
{
  "role": "editor",
  "isActive": true,
  "jobRoleKeys": ["forklift_driver", "maintenance_employee"]
}
```

Recommended UX timing:

1. During onboarding after plant selection.
2. In profile/settings so users can update job responsibilities.
3. Admin override in admin tooling when self-selection is not appropriate.

Current app UI includes a **My Alert Roles** entry in the account dropdown that lets a user update their own `jobRoleKeys`.

## Routing rules implemented

Current built-in default routing in `app.js`:

1. Needs + Material-like sub-status -> `material_alerts` feed -> `forklift_driver` job feed.
2. Maintenance status/category -> `maintenance_alerts` feed -> `maintenance_employee` job feed.

## Runtime behavior

When status changes are saved via `addStatusEntry`:

1. App resolves matching routing rule.
2. App reads plant members and filters active users whose `jobRoleKeys` (or legacy `jobFeeds`) include required keys.
3. App writes an alert record to `plants/{plantId}/roleFeedAlerts` including recipients.
4. If the current user is targeted, an in-app toast is shown.

## Data written for each routed alert

Collection: `plants/{plantId}/roleFeedAlerts`

Fields:

- `issueId`
- `machine`
- `statusKey`
- `subStatus`
- `note`
- `feedKey`
- `feedLabel`
- `requiredJobRoleKeys`
- `recipientUserIds`
- `createdAt`
- `createdBy`

## Notes

- Rule configuration can be managed per-plant in `plants/{plantId}/config/roleAlertRouting.rules`.
- Unknown or missing role keys means user receives no role-based feed alerts.
- Security rules enforce `roleFeedAlerts` as append-only records:
  - read: any active plant member
  - create: editor/admin only
  - update/delete: denied

# Role-Based Alert Feeds (v1)

This document defines how users select job feeds and how issue status updates auto-route alerts.

## User job selection

Users are assigned to job feeds on their plant member document:

- Path: `plants/{plantId}/members/{uid}`
- Field: `jobFeeds: string[]`

Example:

```json
{
  "role": "editor",
  "isActive": true,
  "jobFeeds": ["forklift_driver", "maintenance_employee"]
}
```

Recommended UX timing:

1. During onboarding after plant selection.
2. In profile/settings so users can update job responsibilities.
3. Admin override in admin tooling when self-selection is not appropriate.

## Routing rules implemented

Current built-in routing in `app.js`:

1. Needs + Material-like sub-status -> `material_alerts` feed -> `forklift_driver` job feed.
2. Maintenance status/category -> `maintenance_alerts` feed -> `maintenance_employee` job feed.

## Runtime behavior

When status changes are saved via `addStatusEntry`:

1. App resolves matching routing rule.
2. App reads plant members and filters active users whose `jobFeeds` include required keys.
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
- `requiredJobFeedKeys`
- `recipientUserIds`
- `createdAt`
- `createdBy`

## Notes

- This is app-side routing (v1). Server-side enforcement/notification fanout can be added later.
- Unknown or missing `jobFeeds` means user receives no role-based feed alerts.

# Category Subscription Alerts (v2)

Users subscribe to alert categories, and issues notify everyone subscribed to the selected category.

## Member subscription field

Path: `plants/{plantId}/members/{uid}`

Primary field:
- `alertCategorySubscriptions: string[]`

Backward compatibility still supported:
- `jobRoleKeys: string[]`
- `jobFeeds: string[]`

## User experience

Users can update subscriptions anytime from **Account -> My Alert Categories**.
This is intended for day-to-day flexibility (for replacement operators and rotating assignments).

## Routing behavior

When a status/category is selected on an issue:
1. App resolves the category route.
2. App notifies active members subscribed to that category via `alertCategorySubscriptions`.
3. Legacy role-based matching is still considered as a fallback.
4. App writes an append-only alert doc to `plants/{plantId}/roleFeedAlerts`.

Alerts are created both:
- when logging a new issue with an initial category, and
- when changing a category later.

If no explicit route config exists for a category, the app creates a generic feed key like `<category>_alerts`.

## User delivery path

The app now starts a realtime watcher for each signed-in user/plant:
- Query: `plants/{plantId}/roleFeedAlerts` where `recipientUserIds` contains current uid.
- On new alerts, show in-app toast and browser notification (if permission is granted).
- Watcher is restarted on plant switch and stopped on sign-out.
- Header includes an `❗` alert indicator badge that increments on new delegated category alerts.
- Clicking the `❗` icon opens **Active Category Alerts** modal listing unresolved issues routed to the user.
- Users can delete individual alerts directly from the Active Category Alerts modal.

## Alert payload

`plants/{plantId}/roleFeedAlerts/{alertId}` includes:
- `statusKey`
- `categoryKey`
- `feedKey`
- `feedLabel`
- `recipientUserIds`
- `requiredJobRoleKeys` (legacy compatibility)
- `createdAt`, `createdBy`

## Security

Members may update only their own subscription preference fields.
`roleFeedAlerts` are create/read for routing and delivery, remain update-immutable, and can be deleted by admins or recipient users (dismissal/cleanup).
When an issue is deleted, associated `roleFeedAlerts` rows are deleted in the same operation.

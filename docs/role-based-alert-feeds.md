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
`roleFeedAlerts` stays append-only (create/read allowed per rules, update/delete denied).

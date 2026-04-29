# Timer Zero Alerting + Auto-Critical Escalation (Implementation Prep)

## Goal
Ensure timer expirations are never missed and that expired timers can be auto-escalated to `critical` severity in a controlled, auditable way.

---

## Product Requirements

### Functional
1. When a timer reaches zero, the system emits a single canonical `timer_expired` event.
2. Users receive immediate notification through in-app UI plus at least one out-of-band channel.
3. If the event remains unacknowledged after a configurable grace period, the linked issue is auto-marked `critical`.
4. Users can acknowledge, snooze, or resolve from notification surfaces.
5. All escalation/downgrade transitions are audit-logged.

### Non-Functional
- Idempotent event handling.
- No duplicate critical escalations for the same timer window.
- Delivery retries with backoff.
- UTC storage for all timestamps.

---

## Architecture Decisions

## 1) Source of Truth
- **Backend authoritative timer expiry** (scheduled check or deadline compare on write/read).
- Client can render countdown, but expiry event generation is server-side.

## 2) Canonical Event
Add event type:
- `timer_expired`

Event payload:
- `event_id` (UUID)
- `issue_id`
- `timer_id`
- `expired_at` (UTC)
- `owner_user_id`
- `alert_channels_requested`
- `escalation_policy_version`

## 3) Escalation Rule
Default policy:
- At `T+0`: create alert + send in-app/push/email.
- At `T+30s` unacknowledged: set `issue.priority = critical`.
- Re-notify on interval until acknowledged/resolved or policy cap reached.

---

## Data Model Changes

## `issues` (existing)
Add/ensure fields:
- `priority`: `low | medium | high | critical`
- `priorityChangedAt` (UTC)
- `priorityChangedBy`: `user:<uid> | system:timer-escalation`

## `issueEvents` (existing/new)
Add event documents for:
- `timer_expired`
- `issue_priority_changed`
- `timer_alert_acknowledged`
- `timer_alert_snoozed`

Required fields:
- `id`, `type`, `issueId`, `createdAt`, `actor`, `metadata`

## `timerAlerts` (new helper collection)
Purpose: dedupe + delivery tracking.
Fields:
- `timerId`
- `issueId`
- `status`: `pending | sent | acknowledged | resolved | failed`
- `firstSentAt`
- `lastSentAt`
- `attemptCount`
- `nextAttemptAt`
- `criticalEscalatedAt`
- `dedupeKey` (`timerId + expiryEpochBucket`)

---

## Backend Work Breakdown

1. Implement `emitTimerExpired(timer)` service:
   - idempotency check by dedupe key
   - write `timer_expired` event
   - enqueue notification job

2. Implement `processTimerAlert(alertId)` worker:
   - send channel notifications
   - update attempts and next retry
   - trigger escalation evaluation

3. Implement `evaluateEscalation(alertId)`:
   - if now >= expiry + grace and not acknowledged/resolved:
     - transition priority to `critical`
     - write `issue_priority_changed`

4. Implement acknowledgement APIs/actions:
   - `acknowledgeTimerAlert(alertId)`
   - `snoozeTimerAlert(alertId, duration)`
   - `resolveTimerAlert(alertId)`

5. Add cleanup/guard rails:
   - max notification attempts
   - cooldown between notifications
   - poison/dead-letter tracking

---

## Frontend Work Breakdown

1. Add in-app timer-expired modal/banner.
2. Add clear CTA buttons: **Acknowledge**, **Snooze**, **Open Issue**.
3. Render priority badge changes immediately after escalation events.
4. Support opt-in preferences for channel routing where applicable.

---

## Security + Permissions

- Only allowed principals/services may set `priority=critical` via system path.
- Client writes cannot spoof `system:timer-escalation` actor.
- Rules validate expected state transitions and immutable audit fields.

---

## Observability

Metrics:
- `timer_expired_total`
- `timer_alert_sent_total{channel}`
- `timer_alert_latency_ms`
- `timer_escalation_critical_total`
- `timer_escalation_missed_total`
- `timer_ack_time_ms`

Dashboards:
- alert throughput
- retries/failures
- escalation conversion rate

Alerts:
- worker failures > threshold
- missed escalation SLO

---

## Testing Plan

### Unit
- dedupe key generation
- escalation grace logic
- idempotent event emission

### Integration
- timer expiry -> event -> notification job chain
- unacknowledged expiry transitions to critical
- acknowledged alert blocks escalation

### E2E
- user sees in-app expired modal
- receives out-of-band message (stubbed)
- issue priority updates to critical after grace

### Failure-mode
- notification provider timeout retries
- duplicate queue delivery does not double-escalate

---

## Rollout Plan

1. Feature flag: `timer_expiry_alerts_v1`
2. Shadow mode (emit events, no critical transition)
3. Partial rollout (internal/admin tenants)
4. Full rollout with SLO monitoring
5. Post-rollout review (7 days)

---

## Acceptance Criteria

- 99%+ of expired timers generate a persisted `timer_expired` event.
- No issue receives more than one automatic critical escalation per timer window.
- Median alert latency < 5 seconds from expiry event creation.
- Critical transition remains auditable with actor + timestamp.

---

## Open Questions (resolve before coding)

1. Should grace period be global or per-project configurable?
2. Is SMS required at launch or only push/email?
3. Should auto-critical also page on-call immediately?
4. What is the downgrade policy after acknowledgement/resolution?

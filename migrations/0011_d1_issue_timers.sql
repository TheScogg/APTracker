ALTER TABLE issues ADD COLUMN timer_enabled INTEGER NOT NULL DEFAULT 0 CHECK (timer_enabled IN (0, 1));
ALTER TABLE issues ADD COLUMN timer_started_at TEXT;
ALTER TABLE issues ADD COLUMN timer_due_at TEXT;
ALTER TABLE issues ADD COLUMN timer_due_at_ms INTEGER;
ALTER TABLE issues ADD COLUMN timer_duration_minutes INTEGER;
ALTER TABLE issues ADD COLUMN timer_notification_status TEXT;
ALTER TABLE issues ADD COLUMN timer_notification_owner_uid TEXT;
ALTER TABLE issues ADD COLUMN timer_notification_requested_by_json TEXT CHECK (timer_notification_requested_by_json IS NULL OR json_valid(timer_notification_requested_by_json));
ALTER TABLE issues ADD COLUMN timer_notification_delivery_json TEXT CHECK (timer_notification_delivery_json IS NULL OR json_valid(timer_notification_delivery_json));

CREATE INDEX IF NOT EXISTS ix_issues_timer_pending
ON issues (plant_id, timer_notification_status, timer_due_at_ms)
WHERE timer_enabled = 1;

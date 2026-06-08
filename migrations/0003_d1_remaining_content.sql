PRAGMA foreign_keys = ON;

ALTER TABLE role_feed_alerts ADD COLUMN category_key TEXT;
ALTER TABLE role_feed_alerts ADD COLUMN category_keys_json TEXT CHECK (category_keys_json IS NULL OR json_valid(category_keys_json));
ALTER TABLE role_feed_alerts ADD COLUMN workflow_id TEXT;
ALTER TABLE role_feed_alerts ADD COLUMN feed_key TEXT;
ALTER TABLE role_feed_alerts ADD COLUMN feed_label TEXT;
ALTER TABLE role_feed_alerts ADD COLUMN recipient_user_ids_json TEXT CHECK (recipient_user_ids_json IS NULL OR json_valid(recipient_user_ids_json));
ALTER TABLE role_feed_alerts ADD COLUMN required_job_role_keys_json TEXT CHECK (required_job_role_keys_json IS NULL OR json_valid(required_job_role_keys_json));
ALTER TABLE role_feed_alerts ADD COLUMN created_by_json TEXT CHECK (created_by_json IS NULL OR json_valid(created_by_json));
ALTER TABLE role_feed_alerts ADD COLUMN raw_json TEXT CHECK (raw_json IS NULL OR json_valid(raw_json));

CREATE TABLE IF NOT EXISTS press_notes (
  press_note_id TEXT PRIMARY KEY NOT NULL,
  plant_id TEXT NOT NULL,
  press_id TEXT,
  machine_code TEXT,
  text TEXT,
  photo_count INTEGER NOT NULL DEFAULT 0,
  photos_json TEXT CHECK (photos_json IS NULL OR json_valid(photos_json)),
  created_by_json TEXT CHECK (created_by_json IS NULL OR json_valid(created_by_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  schema_version INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id)
);

CREATE INDEX IF NOT EXISTS ix_press_notes_plant_press ON press_notes (plant_id, press_id, created_at DESC);

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS role_alert_routing_config (
  plant_id TEXT PRIMARY KEY NOT NULL,
  rules_json TEXT NOT NULL CHECK (json_valid(rules_json)),
  updated_by_uid TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id)
);

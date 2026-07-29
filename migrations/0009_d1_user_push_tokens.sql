CREATE TABLE user_push_tokens (
  uid TEXT NOT NULL,
  token_id TEXT NOT NULL,
  token TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'fcm',
  platform TEXT,
  user_agent TEXT,
  notification_permission TEXT,
  plant_ids_json TEXT CHECK (plant_ids_json IS NULL OR json_valid(plant_ids_json)),
  current_plant_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (uid, token_id),
  FOREIGN KEY (uid) REFERENCES users(uid)
);

CREATE INDEX idx_user_push_tokens_provider ON user_push_tokens(provider);

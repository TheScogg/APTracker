PRAGMA foreign_keys = ON;

/*
  AP Tracker D1 core schema v1.

  This is the first Cloudflare D1 migration for the SQL read-path cutover.
  JSON-heavy configuration and compatibility fields stay as TEXT + json_valid()
  so the current mixed Firestore/v2 app model can move over incrementally.
*/

CREATE TABLE users (
  uid TEXT PRIMARY KEY NOT NULL,
  email TEXT,
  display_name TEXT,
  full_name TEXT,
  sso_number TEXT,
  photo_url TEXT,
  default_plant_id TEXT,
  last_plant_id TEXT,
  plant_ids_json TEXT CHECK (plant_ids_json IS NULL OR json_valid(plant_ids_json)),
  requested_plant_ids_json TEXT CHECK (requested_plant_ids_json IS NULL OR json_valid(requested_plant_ids_json)),
  profile_onboarding_json TEXT CHECK (profile_onboarding_json IS NULL OR json_valid(profile_onboarding_json)),
  global_lifetime_xp INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  schema_version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE user_lookup (
  email_normalized TEXT PRIMARY KEY NOT NULL,
  uid TEXT NOT NULL,
  display_name TEXT,
  full_name TEXT,
  sso_number TEXT,
  photo_url TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (uid) REFERENCES users(uid)
);

CREATE TABLE plants (
  plant_id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  code TEXT,
  location TEXT,
  timezone TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by_uid TEXT,
  updated_by_uid TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  schema_version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE plant_members (
  plant_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  role TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  display_name TEXT,
  full_name TEXT,
  sso_number TEXT,
  email TEXT,
  permissions_json TEXT NOT NULL CHECK (json_valid(permissions_json)),
  alert_category_subscriptions_json TEXT CHECK (alert_category_subscriptions_json IS NULL OR json_valid(alert_category_subscriptions_json)),
  job_role_keys_json TEXT CHECK (job_role_keys_json IS NULL OR json_valid(job_role_keys_json)),
  job_feeds_json TEXT CHECK (job_feeds_json IS NULL OR json_valid(job_feeds_json)),
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT,
  PRIMARY KEY (plant_id, uid),
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id),
  FOREIGN KEY (uid) REFERENCES users(uid)
);

CREATE TABLE access_requests (
  plant_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  display_name TEXT,
  full_name TEXT,
  sso_number TEXT,
  email TEXT,
  photo_url TEXT,
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (plant_id, uid),
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id)
);

CREATE TABLE plant_status_config (
  plant_id TEXT PRIMARY KEY NOT NULL,
  statuses_json TEXT NOT NULL CHECK (json_valid(statuses_json)),
  subcategory_routes_json TEXT CHECK (subcategory_routes_json IS NULL OR json_valid(subcategory_routes_json)),
  updated_by_uid TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id)
);

CREATE TABLE plant_press_config (
  plant_id TEXT PRIMARY KEY NOT NULL,
  presses_json TEXT NOT NULL CHECK (json_valid(presses_json)),
  updated_by_uid TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id)
);

CREATE TABLE role_alert_routing_config (
  plant_id TEXT PRIMARY KEY NOT NULL,
  rules_json TEXT NOT NULL CHECK (json_valid(rules_json)),
  updated_by_uid TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id)
);

CREATE TABLE presses (
  plant_id TEXT NOT NULL,
  press_id TEXT NOT NULL,
  machine_code TEXT NOT NULL,
  display_name TEXT,
  row_id TEXT,
  order_in_row INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (plant_id, press_id),
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id)
);

CREATE TABLE issues (
  issue_id TEXT PRIMARY KEY NOT NULL,
  plant_id TEXT NOT NULL,
  press_id TEXT,
  machine_code TEXT,
  row_id TEXT,
  title TEXT,
  note TEXT,
  description TEXT,
  issue_type TEXT,
  priority TEXT,
  severity TEXT,
  high_priority INTEGER NOT NULL DEFAULT 0 CHECK (high_priority IN (0, 1)),
  current_status_key TEXT,
  current_sub_status_key TEXT,
  current_status_label TEXT,
  current_sub_status_label TEXT,
  current_status_color TEXT,
  current_status_entered_at TEXT,
  current_status_entered_by_uid TEXT,
  current_status_entered_by_name TEXT,
  is_open INTEGER NOT NULL DEFAULT 1 CHECK (is_open IN (0, 1)),
  is_resolved INTEGER NOT NULL DEFAULT 0 CHECK (is_resolved IN (0, 1)),
  opened_at TEXT,
  resolved_at TEXT,
  closed_at TEXT,
  reopened_count INTEGER NOT NULL DEFAULT 0,
  assigned_team TEXT,
  assigned_user_uid TEXT,
  assigned_user_name TEXT,
  serial_required INTEGER NOT NULL DEFAULT 0 CHECK (serial_required IN (0, 1)),
  serial_captured INTEGER NOT NULL DEFAULT 0 CHECK (serial_captured IN (0, 1)),
  serial_value TEXT,
  reporting_date_key TEXT,
  reporting_week_key TEXT,
  reporting_month_key TEXT,
  reporting_shift_key TEXT,
  workflow_state TEXT,
  workflow_state_by_entry_json TEXT CHECK (workflow_state_by_entry_json IS NULL OR json_valid(workflow_state_by_entry_json)),
  workflow_state_history_json TEXT CHECK (workflow_state_history_json IS NULL OR json_valid(workflow_state_history_json)),
  legacy_status_history_json TEXT CHECK (legacy_status_history_json IS NULL OR json_valid(legacy_status_history_json)),
  latest_note_preview TEXT,
  tags_json TEXT CHECK (tags_json IS NULL OR json_valid(tags_json)),
  photo_count INTEGER NOT NULL DEFAULT 0,
  created_by_uid TEXT,
  created_by_name TEXT,
  updated_by_uid TEXT,
  updated_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  schema_version INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id)
);

CREATE INDEX ix_issues_live ON issues (plant_id, is_open, created_at DESC);
CREATE INDEX ix_issues_press_live ON issues (plant_id, press_id, is_open, created_at DESC);
CREATE INDEX ix_issues_row_live ON issues (plant_id, row_id, is_open, created_at DESC);
CREATE INDEX ix_issues_status ON issues (plant_id, current_status_key, created_at DESC);
CREATE INDEX ix_issues_reporting_date ON issues (plant_id, reporting_date_key, created_at DESC);

CREATE TABLE issue_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  issue_id TEXT NOT NULL,
  plant_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actor_uid TEXT,
  actor_name TEXT,
  payload_json TEXT CHECK (payload_json IS NULL OR json_valid(payload_json)),
  dedupe_key TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (issue_id) REFERENCES issues(issue_id)
);

CREATE INDEX ix_issue_events_timeline ON issue_events (issue_id, event_at ASC);
CREATE UNIQUE INDEX ux_issue_events_dedupe ON issue_events (plant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE issue_attachments (
  attachment_id TEXT PRIMARY KEY NOT NULL,
  issue_id TEXT NOT NULL,
  plant_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'photo',
  file_name TEXT,
  content_type TEXT,
  storage_bucket TEXT,
  storage_path TEXT NOT NULL,
  thumbnail_path TEXT,
  download_url TEXT,
  uploaded_by_uid TEXT,
  uploaded_by_name TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  size_bytes INTEGER,
  schema_version INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (issue_id) REFERENCES issues(issue_id)
);

CREATE INDEX ix_issue_attachments_issue ON issue_attachments (issue_id, uploaded_at DESC);

CREATE TABLE notes (
  note_id TEXT PRIMARY KEY NOT NULL,
  plant_id TEXT NOT NULL,
  title TEXT,
  body_html TEXT,
  body_text TEXT,
  checklist_items_json TEXT CHECK (checklist_items_json IS NULL OR json_valid(checklist_items_json)),
  tags_json TEXT CHECK (tags_json IS NULL OR json_valid(tags_json)),
  press_id TEXT,
  machine_code TEXT,
  issue_id TEXT,
  is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  photo_count INTEGER NOT NULL DEFAULT 0,
  search_text TEXT,
  created_by_uid TEXT,
  updated_by_uid TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id)
);

CREATE TABLE todos (
  todo_id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL,
  plant_id TEXT,
  owner_uid TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT,
  list_name TEXT,
  due_date TEXT,
  priority TEXT,
  is_completed INTEGER NOT NULL DEFAULT 0 CHECK (is_completed IN (0, 1)),
  completed_at TEXT,
  press_id TEXT,
  machine_code TEXT,
  issue_id TEXT,
  search_text TEXT,
  created_by_json TEXT CHECK (created_by_json IS NULL OR json_valid(created_by_json)),
  updated_by_json TEXT CHECK (updated_by_json IS NULL OR json_valid(updated_by_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX ix_todos_personal ON todos (owner_uid, plant_id, updated_at DESC);
CREATE INDEX ix_todos_shared ON todos (plant_id, scope, updated_at DESC);

CREATE TABLE conversations (
  conversation_id TEXT PRIMARY KEY NOT NULL,
  plant_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT,
  member_ids_json TEXT NOT NULL CHECK (json_valid(member_ids_json)),
  last_message_text TEXT,
  last_message_at TEXT,
  created_by_uid TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id)
);

CREATE TABLE conversation_members (
  conversation_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  last_read_at TEXT,
  muted INTEGER NOT NULL DEFAULT 0 CHECK (muted IN (0, 1)),
  PRIMARY KEY (conversation_id, uid),
  FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id)
);

CREATE TABLE conversation_messages (
  message_id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL,
  plant_id TEXT NOT NULL,
  sender_uid TEXT NOT NULL,
  sender_name TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id)
);

CREATE INDEX ix_conversation_messages_thread ON conversation_messages (conversation_id, created_at ASC);

CREATE TABLE role_feed_alerts (
  alert_id TEXT PRIMARY KEY NOT NULL,
  plant_id TEXT NOT NULL,
  issue_id TEXT,
  status_key TEXT,
  subcategory_key TEXT,
  title TEXT,
  body TEXT,
  is_resolved INTEGER NOT NULL DEFAULT 0 CHECK (is_resolved IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id)
);

CREATE TABLE role_feed_alert_recipients (
  alert_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  read_at TEXT,
  dismissed_at TEXT,
  PRIMARY KEY (alert_id, uid),
  FOREIGN KEY (alert_id) REFERENCES role_feed_alerts(alert_id)
);

CREATE TABLE gamification_config (
  plant_id TEXT PRIMARY KEY NOT NULL,
  config_json TEXT NOT NULL CHECK (json_valid(config_json)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id)
);

CREATE TABLE user_game_stats (
  plant_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  totals_json TEXT NOT NULL CHECK (json_valid(totals_json)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (plant_id, uid),
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id)
);

CREATE TABLE game_events (
  game_event_id TEXT PRIMARY KEY NOT NULL,
  plant_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  type TEXT NOT NULL,
  xp_delta INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT,
  payload_json TEXT CHECK (payload_json IS NULL OR json_valid(payload_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id)
);

CREATE UNIQUE INDEX ux_game_events_dedupe ON game_events (plant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

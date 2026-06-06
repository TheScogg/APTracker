/*
  AP Tracker Azure SQL schema v1.

  This schema mirrors the current plant-scoped Firestore model while keeping
  flexible UI/config payloads in JSON columns for the first migration phase.
*/

CREATE TABLE dbo.users (
  uid NVARCHAR(128) NOT NULL CONSTRAINT pk_users PRIMARY KEY,
  email NVARCHAR(320) NULL,
  display_name NVARCHAR(200) NULL,
  full_name NVARCHAR(200) NULL,
  sso_number NVARCHAR(80) NULL,
  photo_url NVARCHAR(1000) NULL,
  default_plant_id NVARCHAR(80) NULL,
  last_plant_id NVARCHAR(80) NULL,
  plant_ids_json NVARCHAR(MAX) NULL CHECK (plant_ids_json IS NULL OR ISJSON(plant_ids_json) = 1),
  requested_plant_ids_json NVARCHAR(MAX) NULL CHECK (requested_plant_ids_json IS NULL OR ISJSON(requested_plant_ids_json) = 1),
  profile_onboarding_json NVARCHAR(MAX) NULL CHECK (profile_onboarding_json IS NULL OR ISJSON(profile_onboarding_json) = 1),
  global_lifetime_xp INT NOT NULL CONSTRAINT df_users_global_lifetime_xp DEFAULT 0,
  created_at DATETIME2(3) NOT NULL CONSTRAINT df_users_created_at DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2(3) NOT NULL CONSTRAINT df_users_updated_at DEFAULT SYSUTCDATETIME(),
  schema_version INT NOT NULL CONSTRAINT df_users_schema_version DEFAULT 1
);

CREATE TABLE dbo.user_lookup (
  email_normalized NVARCHAR(320) NOT NULL CONSTRAINT pk_user_lookup PRIMARY KEY,
  uid NVARCHAR(128) NOT NULL,
  display_name NVARCHAR(200) NULL,
  full_name NVARCHAR(200) NULL,
  sso_number NVARCHAR(80) NULL,
  photo_url NVARCHAR(1000) NULL,
  updated_at DATETIME2(3) NOT NULL CONSTRAINT df_user_lookup_updated_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT fk_user_lookup_user FOREIGN KEY (uid) REFERENCES dbo.users(uid)
);

CREATE TABLE dbo.plants (
  plant_id NVARCHAR(80) NOT NULL CONSTRAINT pk_plants PRIMARY KEY,
  name NVARCHAR(200) NOT NULL,
  code NVARCHAR(40) NULL,
  location NVARCHAR(200) NULL,
  timezone NVARCHAR(100) NULL,
  is_active BIT NOT NULL CONSTRAINT df_plants_is_active DEFAULT 1,
  created_by_uid NVARCHAR(128) NULL,
  updated_by_uid NVARCHAR(128) NULL,
  created_at DATETIME2(3) NOT NULL CONSTRAINT df_plants_created_at DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2(3) NOT NULL CONSTRAINT df_plants_updated_at DEFAULT SYSUTCDATETIME(),
  schema_version INT NOT NULL CONSTRAINT df_plants_schema_version DEFAULT 1
);

CREATE TABLE dbo.plant_members (
  plant_id NVARCHAR(80) NOT NULL,
  uid NVARCHAR(128) NOT NULL,
  role NVARCHAR(40) NOT NULL,
  is_active BIT NOT NULL CONSTRAINT df_plant_members_is_active DEFAULT 1,
  display_name NVARCHAR(200) NULL,
  full_name NVARCHAR(200) NULL,
  sso_number NVARCHAR(80) NULL,
  email NVARCHAR(320) NULL,
  permissions_json NVARCHAR(MAX) NOT NULL CHECK (ISJSON(permissions_json) = 1),
  joined_at DATETIME2(3) NOT NULL CONSTRAINT df_plant_members_joined_at DEFAULT SYSUTCDATETIME(),
  last_seen_at DATETIME2(3) NULL,
  PRIMARY KEY (plant_id, uid),
  CONSTRAINT fk_plant_members_plant FOREIGN KEY (plant_id) REFERENCES dbo.plants(plant_id),
  CONSTRAINT fk_plant_members_user FOREIGN KEY (uid) REFERENCES dbo.users(uid)
);

CREATE TABLE dbo.access_requests (
  plant_id NVARCHAR(80) NOT NULL,
  uid NVARCHAR(128) NOT NULL,
  status NVARCHAR(40) NOT NULL CONSTRAINT df_access_requests_status DEFAULT 'pending',
  display_name NVARCHAR(200) NULL,
  full_name NVARCHAR(200) NULL,
  sso_number NVARCHAR(80) NULL,
  email NVARCHAR(320) NULL,
  photo_url NVARCHAR(1000) NULL,
  requested_at DATETIME2(3) NOT NULL CONSTRAINT df_access_requests_requested_at DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2(3) NOT NULL CONSTRAINT df_access_requests_updated_at DEFAULT SYSUTCDATETIME(),
  PRIMARY KEY (plant_id, uid),
  CONSTRAINT fk_access_requests_plant FOREIGN KEY (plant_id) REFERENCES dbo.plants(plant_id)
);

CREATE TABLE dbo.plant_status_config (
  plant_id NVARCHAR(80) NOT NULL CONSTRAINT pk_plant_status_config PRIMARY KEY,
  statuses_json NVARCHAR(MAX) NOT NULL CHECK (ISJSON(statuses_json) = 1),
  subcategory_routes_json NVARCHAR(MAX) NULL CHECK (subcategory_routes_json IS NULL OR ISJSON(subcategory_routes_json) = 1),
  updated_by_uid NVARCHAR(128) NULL,
  updated_at DATETIME2(3) NOT NULL CONSTRAINT df_plant_status_config_updated_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT fk_plant_status_config_plant FOREIGN KEY (plant_id) REFERENCES dbo.plants(plant_id)
);

CREATE TABLE dbo.plant_press_config (
  plant_id NVARCHAR(80) NOT NULL CONSTRAINT pk_plant_press_config PRIMARY KEY,
  presses_json NVARCHAR(MAX) NOT NULL CHECK (ISJSON(presses_json) = 1),
  updated_by_uid NVARCHAR(128) NULL,
  updated_at DATETIME2(3) NOT NULL CONSTRAINT df_plant_press_config_updated_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT fk_plant_press_config_plant FOREIGN KEY (plant_id) REFERENCES dbo.plants(plant_id)
);

CREATE TABLE dbo.presses (
  plant_id NVARCHAR(80) NOT NULL,
  press_id NVARCHAR(100) NOT NULL,
  machine_code NVARCHAR(80) NOT NULL,
  display_name NVARCHAR(200) NULL,
  row_id NVARCHAR(80) NULL,
  order_in_row INT NULL,
  is_active BIT NOT NULL CONSTRAINT df_presses_is_active DEFAULT 1,
  metadata_json NVARCHAR(MAX) NULL CHECK (metadata_json IS NULL OR ISJSON(metadata_json) = 1),
  created_at DATETIME2(3) NOT NULL CONSTRAINT df_presses_created_at DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2(3) NOT NULL CONSTRAINT df_presses_updated_at DEFAULT SYSUTCDATETIME(),
  PRIMARY KEY (plant_id, press_id),
  CONSTRAINT fk_presses_plant FOREIGN KEY (plant_id) REFERENCES dbo.plants(plant_id)
);

CREATE TABLE dbo.issues (
  issue_id NVARCHAR(128) NOT NULL CONSTRAINT pk_issues PRIMARY KEY,
  plant_id NVARCHAR(80) NOT NULL,
  press_id NVARCHAR(100) NULL,
  machine_code NVARCHAR(80) NULL,
  row_id NVARCHAR(80) NULL,
  title NVARCHAR(300) NULL,
  note NVARCHAR(MAX) NULL,
  description NVARCHAR(MAX) NULL,
  issue_type NVARCHAR(80) NULL,
  priority NVARCHAR(40) NULL,
  severity NVARCHAR(80) NULL,
  high_priority BIT NOT NULL CONSTRAINT df_issues_high_priority DEFAULT 0,
  current_status_key NVARCHAR(80) NULL,
  current_sub_status_key NVARCHAR(160) NULL,
  current_status_label NVARCHAR(160) NULL,
  current_sub_status_label NVARCHAR(200) NULL,
  current_status_color NVARCHAR(40) NULL,
  current_status_entered_at DATETIME2(3) NULL,
  current_status_entered_by_uid NVARCHAR(128) NULL,
  current_status_entered_by_name NVARCHAR(200) NULL,
  is_open BIT NOT NULL CONSTRAINT df_issues_is_open DEFAULT 1,
  is_resolved BIT NOT NULL CONSTRAINT df_issues_is_resolved DEFAULT 0,
  opened_at DATETIME2(3) NULL,
  resolved_at DATETIME2(3) NULL,
  closed_at DATETIME2(3) NULL,
  reopened_count INT NOT NULL CONSTRAINT df_issues_reopened_count DEFAULT 0,
  assigned_team NVARCHAR(80) NULL,
  assigned_user_uid NVARCHAR(128) NULL,
  assigned_user_name NVARCHAR(200) NULL,
  serial_required BIT NOT NULL CONSTRAINT df_issues_serial_required DEFAULT 0,
  serial_captured BIT NOT NULL CONSTRAINT df_issues_serial_captured DEFAULT 0,
  serial_value NVARCHAR(200) NULL,
  reporting_date_key CHAR(10) NULL,
  reporting_week_key NVARCHAR(16) NULL,
  reporting_month_key CHAR(7) NULL,
  reporting_shift_key NVARCHAR(20) NULL,
  workflow_state NVARCHAR(80) NULL,
  workflow_state_by_entry_json NVARCHAR(MAX) NULL CHECK (workflow_state_by_entry_json IS NULL OR ISJSON(workflow_state_by_entry_json) = 1),
  workflow_state_history_json NVARCHAR(MAX) NULL CHECK (workflow_state_history_json IS NULL OR ISJSON(workflow_state_history_json) = 1),
  legacy_status_history_json NVARCHAR(MAX) NULL CHECK (legacy_status_history_json IS NULL OR ISJSON(legacy_status_history_json) = 1),
  latest_note_preview NVARCHAR(500) NULL,
  tags_json NVARCHAR(MAX) NULL CHECK (tags_json IS NULL OR ISJSON(tags_json) = 1),
  photo_count INT NOT NULL CONSTRAINT df_issues_photo_count DEFAULT 0,
  created_by_uid NVARCHAR(128) NULL,
  created_by_name NVARCHAR(200) NULL,
  updated_by_uid NVARCHAR(128) NULL,
  updated_by_name NVARCHAR(200) NULL,
  created_at DATETIME2(3) NOT NULL CONSTRAINT df_issues_created_at DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2(3) NOT NULL CONSTRAINT df_issues_updated_at DEFAULT SYSUTCDATETIME(),
  schema_version INT NOT NULL CONSTRAINT df_issues_schema_version DEFAULT 1,
  CONSTRAINT fk_issues_plant FOREIGN KEY (plant_id) REFERENCES dbo.plants(plant_id)
);

CREATE INDEX ix_issues_live ON dbo.issues (plant_id, is_open, created_at DESC);
CREATE INDEX ix_issues_press_live ON dbo.issues (plant_id, press_id, is_open, created_at DESC);
CREATE INDEX ix_issues_row_live ON dbo.issues (plant_id, row_id, is_open, created_at DESC);
CREATE INDEX ix_issues_status ON dbo.issues (plant_id, current_status_key, created_at DESC);
CREATE INDEX ix_issues_reporting_date ON dbo.issues (plant_id, reporting_date_key, created_at DESC);

CREATE TABLE dbo.issue_events (
  event_id NVARCHAR(128) NOT NULL CONSTRAINT pk_issue_events PRIMARY KEY,
  issue_id NVARCHAR(128) NOT NULL,
  plant_id NVARCHAR(80) NOT NULL,
  event_type NVARCHAR(80) NOT NULL,
  event_at DATETIME2(3) NOT NULL CONSTRAINT df_issue_events_event_at DEFAULT SYSUTCDATETIME(),
  actor_uid NVARCHAR(128) NULL,
  actor_name NVARCHAR(200) NULL,
  payload_json NVARCHAR(MAX) NULL CHECK (payload_json IS NULL OR ISJSON(payload_json) = 1),
  dedupe_key NVARCHAR(300) NULL,
  created_at DATETIME2(3) NOT NULL CONSTRAINT df_issue_events_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT fk_issue_events_issue FOREIGN KEY (issue_id) REFERENCES dbo.issues(issue_id)
);

CREATE INDEX ix_issue_events_timeline ON dbo.issue_events (issue_id, event_at ASC);
CREATE UNIQUE INDEX ux_issue_events_dedupe ON dbo.issue_events (plant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE dbo.issue_attachments (
  attachment_id NVARCHAR(128) NOT NULL CONSTRAINT pk_issue_attachments PRIMARY KEY,
  issue_id NVARCHAR(128) NOT NULL,
  plant_id NVARCHAR(80) NOT NULL,
  type NVARCHAR(40) NOT NULL CONSTRAINT df_issue_attachments_type DEFAULT 'photo',
  file_name NVARCHAR(300) NULL,
  content_type NVARCHAR(100) NULL,
  storage_bucket NVARCHAR(300) NULL,
  storage_path NVARCHAR(1000) NOT NULL,
  thumbnail_path NVARCHAR(1000) NULL,
  download_url NVARCHAR(2000) NULL,
  uploaded_by_uid NVARCHAR(128) NULL,
  uploaded_by_name NVARCHAR(200) NULL,
  uploaded_at DATETIME2(3) NOT NULL CONSTRAINT df_issue_attachments_uploaded_at DEFAULT SYSUTCDATETIME(),
  size_bytes BIGINT NULL,
  schema_version INT NOT NULL CONSTRAINT df_issue_attachments_schema_version DEFAULT 1,
  CONSTRAINT fk_issue_attachments_issue FOREIGN KEY (issue_id) REFERENCES dbo.issues(issue_id)
);

CREATE INDEX ix_issue_attachments_issue ON dbo.issue_attachments (issue_id, uploaded_at DESC);

CREATE TABLE dbo.notes (
  note_id NVARCHAR(128) NOT NULL CONSTRAINT pk_notes PRIMARY KEY,
  plant_id NVARCHAR(80) NOT NULL,
  title NVARCHAR(300) NULL,
  body_html NVARCHAR(MAX) NULL,
  body_text NVARCHAR(MAX) NULL,
  checklist_items_json NVARCHAR(MAX) NULL CHECK (checklist_items_json IS NULL OR ISJSON(checklist_items_json) = 1),
  tags_json NVARCHAR(MAX) NULL CHECK (tags_json IS NULL OR ISJSON(tags_json) = 1),
  press_id NVARCHAR(100) NULL,
  machine_code NVARCHAR(80) NULL,
  issue_id NVARCHAR(128) NULL,
  is_pinned BIT NOT NULL CONSTRAINT df_notes_is_pinned DEFAULT 0,
  is_archived BIT NOT NULL CONSTRAINT df_notes_is_archived DEFAULT 0,
  photo_count INT NOT NULL CONSTRAINT df_notes_photo_count DEFAULT 0,
  search_text NVARCHAR(MAX) NULL,
  created_by_uid NVARCHAR(128) NULL,
  updated_by_uid NVARCHAR(128) NULL,
  created_at DATETIME2(3) NOT NULL CONSTRAINT df_notes_created_at DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2(3) NOT NULL CONSTRAINT df_notes_updated_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT fk_notes_plant FOREIGN KEY (plant_id) REFERENCES dbo.plants(plant_id)
);

CREATE TABLE dbo.todos (
  todo_id NVARCHAR(128) NOT NULL CONSTRAINT pk_todos PRIMARY KEY,
  scope NVARCHAR(20) NOT NULL,
  plant_id NVARCHAR(80) NULL,
  owner_uid NVARCHAR(128) NOT NULL,
  title NVARCHAR(300) NOT NULL,
  notes NVARCHAR(MAX) NULL,
  list_name NVARCHAR(120) NULL,
  due_date DATE NULL,
  priority NVARCHAR(40) NULL,
  is_completed BIT NOT NULL CONSTRAINT df_todos_is_completed DEFAULT 0,
  completed_at DATETIME2(3) NULL,
  press_id NVARCHAR(100) NULL,
  machine_code NVARCHAR(80) NULL,
  issue_id NVARCHAR(128) NULL,
  search_text NVARCHAR(MAX) NULL,
  created_by_json NVARCHAR(MAX) NULL CHECK (created_by_json IS NULL OR ISJSON(created_by_json) = 1),
  updated_by_json NVARCHAR(MAX) NULL CHECK (updated_by_json IS NULL OR ISJSON(updated_by_json) = 1),
  created_at DATETIME2(3) NOT NULL CONSTRAINT df_todos_created_at DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2(3) NOT NULL CONSTRAINT df_todos_updated_at DEFAULT SYSUTCDATETIME()
);

CREATE INDEX ix_todos_personal ON dbo.todos (owner_uid, plant_id, updated_at DESC);
CREATE INDEX ix_todos_shared ON dbo.todos (plant_id, scope, updated_at DESC);

CREATE TABLE dbo.conversations (
  conversation_id NVARCHAR(128) NOT NULL CONSTRAINT pk_conversations PRIMARY KEY,
  plant_id NVARCHAR(80) NOT NULL,
  type NVARCHAR(40) NOT NULL,
  title NVARCHAR(300) NULL,
  member_ids_json NVARCHAR(MAX) NOT NULL CHECK (ISJSON(member_ids_json) = 1),
  last_message_text NVARCHAR(1000) NULL,
  last_message_at DATETIME2(3) NULL,
  created_by_uid NVARCHAR(128) NULL,
  created_at DATETIME2(3) NOT NULL CONSTRAINT df_conversations_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT fk_conversations_plant FOREIGN KEY (plant_id) REFERENCES dbo.plants(plant_id)
);

CREATE TABLE dbo.conversation_members (
  conversation_id NVARCHAR(128) NOT NULL,
  uid NVARCHAR(128) NOT NULL,
  last_read_at DATETIME2(3) NULL,
  muted BIT NOT NULL CONSTRAINT df_conversation_members_muted DEFAULT 0,
  PRIMARY KEY (conversation_id, uid),
  CONSTRAINT fk_conversation_members_conversation FOREIGN KEY (conversation_id) REFERENCES dbo.conversations(conversation_id)
);

CREATE TABLE dbo.conversation_messages (
  message_id NVARCHAR(128) NOT NULL CONSTRAINT pk_conversation_messages PRIMARY KEY,
  conversation_id NVARCHAR(128) NOT NULL,
  plant_id NVARCHAR(80) NOT NULL,
  sender_uid NVARCHAR(128) NOT NULL,
  sender_name NVARCHAR(200) NULL,
  body NVARCHAR(MAX) NOT NULL,
  created_at DATETIME2(3) NOT NULL CONSTRAINT df_conversation_messages_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT fk_conversation_messages_conversation FOREIGN KEY (conversation_id) REFERENCES dbo.conversations(conversation_id)
);

CREATE INDEX ix_conversation_messages_thread ON dbo.conversation_messages (conversation_id, created_at ASC);

CREATE TABLE dbo.role_feed_alerts (
  alert_id NVARCHAR(128) NOT NULL CONSTRAINT pk_role_feed_alerts PRIMARY KEY,
  plant_id NVARCHAR(80) NOT NULL,
  issue_id NVARCHAR(128) NULL,
  status_key NVARCHAR(80) NULL,
  subcategory_key NVARCHAR(160) NULL,
  title NVARCHAR(300) NULL,
  body NVARCHAR(MAX) NULL,
  is_resolved BIT NOT NULL CONSTRAINT df_role_feed_alerts_is_resolved DEFAULT 0,
  created_at DATETIME2(3) NOT NULL CONSTRAINT df_role_feed_alerts_created_at DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2(3) NOT NULL CONSTRAINT df_role_feed_alerts_updated_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT fk_role_feed_alerts_plant FOREIGN KEY (plant_id) REFERENCES dbo.plants(plant_id)
);

CREATE TABLE dbo.role_feed_alert_recipients (
  alert_id NVARCHAR(128) NOT NULL,
  uid NVARCHAR(128) NOT NULL,
  read_at DATETIME2(3) NULL,
  dismissed_at DATETIME2(3) NULL,
  PRIMARY KEY (alert_id, uid),
  CONSTRAINT fk_role_feed_alert_recipients_alert FOREIGN KEY (alert_id) REFERENCES dbo.role_feed_alerts(alert_id)
);

CREATE TABLE dbo.gamification_config (
  plant_id NVARCHAR(80) NOT NULL CONSTRAINT pk_gamification_config PRIMARY KEY,
  config_json NVARCHAR(MAX) NOT NULL CHECK (ISJSON(config_json) = 1),
  updated_at DATETIME2(3) NOT NULL CONSTRAINT df_gamification_config_updated_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT fk_gamification_config_plant FOREIGN KEY (plant_id) REFERENCES dbo.plants(plant_id)
);

CREATE TABLE dbo.user_game_stats (
  plant_id NVARCHAR(80) NOT NULL,
  uid NVARCHAR(128) NOT NULL,
  totals_json NVARCHAR(MAX) NOT NULL CHECK (ISJSON(totals_json) = 1),
  updated_at DATETIME2(3) NOT NULL CONSTRAINT df_user_game_stats_updated_at DEFAULT SYSUTCDATETIME(),
  PRIMARY KEY (plant_id, uid),
  CONSTRAINT fk_user_game_stats_plant FOREIGN KEY (plant_id) REFERENCES dbo.plants(plant_id)
);

CREATE TABLE dbo.game_events (
  game_event_id NVARCHAR(128) NOT NULL CONSTRAINT pk_game_events PRIMARY KEY,
  plant_id NVARCHAR(80) NOT NULL,
  uid NVARCHAR(128) NOT NULL,
  type NVARCHAR(80) NOT NULL,
  xp_delta INT NOT NULL CONSTRAINT df_game_events_xp_delta DEFAULT 0,
  dedupe_key NVARCHAR(300) NULL,
  payload_json NVARCHAR(MAX) NULL CHECK (payload_json IS NULL OR ISJSON(payload_json) = 1),
  created_at DATETIME2(3) NOT NULL CONSTRAINT df_game_events_created_at DEFAULT SYSUTCDATETIME(),
  CONSTRAINT fk_game_events_plant FOREIGN KEY (plant_id) REFERENCES dbo.plants(plant_id)
);

CREATE UNIQUE INDEX ux_game_events_dedupe ON dbo.game_events (plant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

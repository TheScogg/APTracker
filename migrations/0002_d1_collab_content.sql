PRAGMA foreign_keys = ON;

ALTER TABLE conversations ADD COLUMN press_id TEXT;
ALTER TABLE conversations ADD COLUMN member_count INTEGER;
ALTER TABLE conversations ADD COLUMN created_by_name TEXT;
ALTER TABLE conversations ADD COLUMN last_message_json TEXT CHECK (last_message_json IS NULL OR json_valid(last_message_json));
ALTER TABLE conversations ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1));

ALTER TABLE conversation_members ADD COLUMN role TEXT;
ALTER TABLE conversation_members ADD COLUMN joined_at TEXT;
ALTER TABLE conversation_members ADD COLUMN last_read_message_id TEXT;
ALTER TABLE conversation_members ADD COLUMN unread_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE conversation_messages ADD COLUMN type TEXT NOT NULL DEFAULT 'text';
ALTER TABLE conversation_messages ADD COLUMN mentions_json TEXT CHECK (mentions_json IS NULL OR json_valid(mentions_json));
ALTER TABLE conversation_messages ADD COLUMN attachments_json TEXT CHECK (attachments_json IS NULL OR json_valid(attachments_json));
ALTER TABLE conversation_messages ADD COLUMN edited_at TEXT;
ALTER TABLE conversation_messages ADD COLUMN deleted_at TEXT;

ALTER TABLE user_game_stats ADD COLUMN user_id TEXT;
ALTER TABLE user_game_stats ADD COLUMN display_name TEXT;
ALTER TABLE user_game_stats ADD COLUMN streaks_json TEXT CHECK (streaks_json IS NULL OR json_valid(streaks_json));
ALTER TABLE user_game_stats ADD COLUMN last_event_at TEXT;
ALTER TABLE user_game_stats ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS note_attachments (
  note_attachment_id TEXT PRIMARY KEY NOT NULL,
  note_id TEXT NOT NULL,
  plant_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  storage_bucket TEXT,
  file_name TEXT,
  content_type TEXT,
  size_bytes INTEGER,
  url TEXT,
  uploaded_by_json TEXT CHECK (uploaded_by_json IS NULL OR json_valid(uploaded_by_json)),
  uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  schema_version INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (note_id) REFERENCES notes(note_id)
);

CREATE INDEX IF NOT EXISTS ix_note_attachments_note ON note_attachments (note_id, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS wiki_pages (
  wiki_page_row_id TEXT PRIMARY KEY NOT NULL,
  plant_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  press_id TEXT,
  page_id TEXT NOT NULL,
  title TEXT,
  slug TEXT,
  summary TEXT,
  tags_json TEXT CHECK (tags_json IS NULL OR json_valid(tags_json)),
  parent_page_id TEXT,
  sort_order INTEGER,
  is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
  is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
  visibility TEXT,
  current_revision_id TEXT,
  photo_count INTEGER NOT NULL DEFAULT 0,
  search_text TEXT,
  created_by_json TEXT CHECK (created_by_json IS NULL OR json_valid(created_by_json)),
  updated_by_json TEXT CHECK (updated_by_json IS NULL OR json_valid(updated_by_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_activity_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_verified_at TEXT,
  last_verified_by TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (plant_id, scope, press_id, page_id)
);

CREATE INDEX IF NOT EXISTS ix_wiki_pages_scope ON wiki_pages (plant_id, scope, press_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS wiki_revisions (
  wiki_revision_row_id TEXT PRIMARY KEY NOT NULL,
  wiki_page_row_id TEXT NOT NULL,
  plant_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  press_id TEXT,
  page_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  body TEXT,
  change_note TEXT,
  prev_revision_id TEXT,
  edited_by_json TEXT CHECK (edited_by_json IS NULL OR json_valid(edited_by_json)),
  edited_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (wiki_page_row_id) REFERENCES wiki_pages(wiki_page_row_id)
);

CREATE INDEX IF NOT EXISTS ix_wiki_revisions_page ON wiki_revisions (wiki_page_row_id, edited_at DESC);

CREATE TABLE IF NOT EXISTS wiki_attachments (
  wiki_attachment_row_id TEXT PRIMARY KEY NOT NULL,
  wiki_page_row_id TEXT NOT NULL,
  plant_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  press_id TEXT,
  page_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  content_type TEXT,
  caption TEXT,
  linked_revision_id TEXT,
  uploaded_by_json TEXT CHECK (uploaded_by_json IS NULL OR json_valid(uploaded_by_json)),
  uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  width INTEGER,
  height INTEGER,
  url TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (wiki_page_row_id) REFERENCES wiki_pages(wiki_page_row_id)
);

CREATE INDEX IF NOT EXISTS ix_wiki_attachments_page ON wiki_attachments (wiki_page_row_id, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS game_leaderboards (
  leaderboard_row_id TEXT PRIMARY KEY NOT NULL,
  plant_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  entries_json TEXT CHECK (entries_json IS NULL OR json_valid(entries_json)),
  entries_by_uid_json TEXT CHECK (entries_by_uid_json IS NULL OR json_valid(entries_by_uid_json)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  schema_version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (plant_id, board_id)
);

CREATE TABLE IF NOT EXISTS game_missions (
  mission_row_id TEXT PRIMARY KEY NOT NULL,
  plant_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  name TEXT,
  description TEXT,
  objective_json TEXT CHECK (objective_json IS NULL OR json_valid(objective_json)),
  rewards_json TEXT CHECK (rewards_json IS NULL OR json_valid(rewards_json)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  starts_at TEXT,
  ends_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  raw_json TEXT CHECK (raw_json IS NULL OR json_valid(raw_json)),
  UNIQUE (plant_id, mission_id)
);

CREATE TABLE IF NOT EXISTS game_mission_progress (
  mission_progress_row_id TEXT PRIMARY KEY NOT NULL,
  plant_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  subject_type TEXT,
  current_value INTEGER,
  target_value INTEGER,
  percent INTEGER,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  raw_json TEXT CHECK (raw_json IS NULL OR json_valid(raw_json)),
  UNIQUE (plant_id, mission_id, subject_id)
);

CREATE TABLE IF NOT EXISTS user_badges (
  plant_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  earned_badges_json TEXT CHECK (earned_badges_json IS NULL OR json_valid(earned_badges_json)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (plant_id, uid)
);

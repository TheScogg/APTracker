PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS plant_store_config (
  plant_id TEXT PRIMARY KEY NOT NULL,
  config_json TEXT NOT NULL CHECK (json_valid(config_json)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id)
);

CREATE TABLE IF NOT EXISTS daily_schedules (
  daily_schedule_row_id TEXT PRIMARY KEY NOT NULL,
  plant_id TEXT NOT NULL,
  schedule_date TEXT NOT NULL,
  shift TEXT,
  line_speed TEXT,
  total_planned_pcs TEXT,
  source_file_name TEXT,
  source_file_type TEXT,
  status TEXT,
  notes TEXT,
  page1_count INTEGER NOT NULL DEFAULT 0,
  page2_count INTEGER NOT NULL DEFAULT 0,
  north_bay_changes_count INTEGER NOT NULL DEFAULT 0,
  south_bay_changes_count INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT CHECK (raw_json IS NULL OR json_valid(raw_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (plant_id, schedule_date),
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id)
);

CREATE INDEX IF NOT EXISTS ix_daily_schedules_plant_date
  ON daily_schedules (plant_id, schedule_date DESC);

CREATE TABLE IF NOT EXISTS daily_schedule_rows (
  daily_schedule_item_row_id TEXT PRIMARY KEY NOT NULL,
  plant_id TEXT NOT NULL,
  schedule_date TEXT NOT NULL,
  section_key TEXT NOT NULL,
  row_id TEXT NOT NULL,
  press TEXT,
  part_number TEXT,
  description TEXT,
  cavity TEXT,
  doh TEXT,
  labels_per_shift TEXT,
  mc TEXT,
  notes TEXT,
  shift TEXT,
  part_storage_location_json TEXT CHECK (part_storage_location_json IS NULL OR json_valid(part_storage_location_json)),
  raw_json TEXT CHECK (raw_json IS NULL OR json_valid(raw_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (plant_id, schedule_date, section_key, row_id),
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id)
);

CREATE INDEX IF NOT EXISTS ix_daily_schedule_rows_plant_section
  ON daily_schedule_rows (plant_id, schedule_date DESC, section_key, press);

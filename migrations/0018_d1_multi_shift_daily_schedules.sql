-- Allow up to three independently imported schedules per plant and calendar day.
-- Existing date-only schedules retain their recorded shift, defaulting to Shift 1
-- only for legacy rows that predate the required shift field.

CREATE TABLE daily_schedules_new (
  daily_schedule_row_id TEXT PRIMARY KEY NOT NULL,
  plant_id TEXT NOT NULL,
  schedule_date TEXT NOT NULL,
  shift TEXT NOT NULL CHECK (shift IN ('1', '2', '3')),
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
  UNIQUE (plant_id, schedule_date, shift),
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id)
);

INSERT INTO daily_schedules_new (
  daily_schedule_row_id, plant_id, schedule_date, shift, line_speed, total_planned_pcs,
  source_file_name, source_file_type, status, notes, page1_count, page2_count,
  north_bay_changes_count, south_bay_changes_count, raw_json, created_at, updated_at
)
SELECT
  plant_id || ':' || schedule_date || ':shift' ||
    CASE lower(trim(COALESCE(shift, '')))
      WHEN '2' THEN '2' WHEN 'second' THEN '2' WHEN 'second shift' THEN '2'
      WHEN '3' THEN '3' WHEN 'third' THEN '3' WHEN 'third shift' THEN '3'
      ELSE '1'
    END,
  plant_id,
  schedule_date,
  CASE lower(trim(COALESCE(shift, '')))
    WHEN '2' THEN '2' WHEN 'second' THEN '2' WHEN 'second shift' THEN '2'
    WHEN '3' THEN '3' WHEN 'third' THEN '3' WHEN 'third shift' THEN '3'
    ELSE '1'
  END,
  line_speed,
  total_planned_pcs,
  source_file_name,
  source_file_type,
  status,
  notes,
  page1_count,
  page2_count,
  north_bay_changes_count,
  south_bay_changes_count,
  raw_json,
  created_at,
  updated_at
FROM daily_schedules;

CREATE TABLE daily_schedule_rows_new (
  daily_schedule_item_row_id TEXT PRIMARY KEY NOT NULL,
  daily_schedule_row_id TEXT NOT NULL,
  plant_id TEXT NOT NULL,
  schedule_date TEXT NOT NULL,
  section_key TEXT NOT NULL,
  row_id TEXT NOT NULL,
  press TEXT,
  part_number TEXT,
  cavity TEXT,
  doh TEXT,
  labels_per_shift TEXT,
  mc TEXT,
  notes TEXT,
  shift TEXT NOT NULL CHECK (shift IN ('1', '2', '3')),
  part_storage_location_json TEXT CHECK (part_storage_location_json IS NULL OR json_valid(part_storage_location_json)),
  raw_json TEXT CHECK (raw_json IS NULL OR json_valid(raw_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (plant_id, schedule_date, shift, section_key, row_id),
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id),
  FOREIGN KEY (daily_schedule_row_id) REFERENCES daily_schedules_new(daily_schedule_row_id) ON DELETE CASCADE,
  FOREIGN KEY (part_number) REFERENCES parts(part_number)
);

INSERT INTO daily_schedule_rows_new (
  daily_schedule_item_row_id, daily_schedule_row_id, plant_id, schedule_date, section_key,
  row_id, press, part_number, cavity, doh, labels_per_shift, mc, notes, shift,
  part_storage_location_json, raw_json, created_at, updated_at
)
SELECT
  r.plant_id || ':' || r.schedule_date || ':shift' ||
    CASE lower(trim(COALESCE(s.shift, r.shift, '')))
      WHEN '2' THEN '2' WHEN 'second' THEN '2' WHEN 'second shift' THEN '2'
      WHEN '3' THEN '3' WHEN 'third' THEN '3' WHEN 'third shift' THEN '3'
      ELSE '1'
    END || ':' || r.section_key || ':' || r.row_id,
  r.plant_id || ':' || r.schedule_date || ':shift' ||
    CASE lower(trim(COALESCE(s.shift, r.shift, '')))
      WHEN '2' THEN '2' WHEN 'second' THEN '2' WHEN 'second shift' THEN '2'
      WHEN '3' THEN '3' WHEN 'third' THEN '3' WHEN 'third shift' THEN '3'
      ELSE '1'
    END,
  r.plant_id,
  r.schedule_date,
  r.section_key,
  r.row_id,
  r.press,
  r.part_number,
  r.cavity,
  r.doh,
  r.labels_per_shift,
  r.mc,
  r.notes,
  CASE lower(trim(COALESCE(s.shift, r.shift, '')))
    WHEN '2' THEN '2' WHEN 'second' THEN '2' WHEN 'second shift' THEN '2'
    WHEN '3' THEN '3' WHEN 'third' THEN '3' WHEN 'third shift' THEN '3'
    ELSE '1'
  END,
  r.part_storage_location_json,
  r.raw_json,
  r.created_at,
  r.updated_at
FROM daily_schedule_rows r
LEFT JOIN daily_schedules s
  ON s.plant_id = r.plant_id AND s.schedule_date = r.schedule_date;

DROP TABLE daily_schedule_rows;
DROP TABLE daily_schedules;
ALTER TABLE daily_schedules_new RENAME TO daily_schedules;
ALTER TABLE daily_schedule_rows_new RENAME TO daily_schedule_rows;

-- Rebuild the child after the parent has its final name. This keeps the foreign
-- key correct even when the migration runner has PRAGMA foreign_keys disabled
-- while applying ALTER TABLE statements.
CREATE TABLE daily_schedule_rows_final (
  daily_schedule_item_row_id TEXT PRIMARY KEY NOT NULL,
  daily_schedule_row_id TEXT NOT NULL,
  plant_id TEXT NOT NULL,
  schedule_date TEXT NOT NULL,
  section_key TEXT NOT NULL,
  row_id TEXT NOT NULL,
  press TEXT,
  part_number TEXT,
  cavity TEXT,
  doh TEXT,
  labels_per_shift TEXT,
  mc TEXT,
  notes TEXT,
  shift TEXT NOT NULL CHECK (shift IN ('1', '2', '3')),
  part_storage_location_json TEXT CHECK (part_storage_location_json IS NULL OR json_valid(part_storage_location_json)),
  raw_json TEXT CHECK (raw_json IS NULL OR json_valid(raw_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (plant_id, schedule_date, shift, section_key, row_id),
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id),
  FOREIGN KEY (daily_schedule_row_id) REFERENCES daily_schedules(daily_schedule_row_id) ON DELETE CASCADE,
  FOREIGN KEY (part_number) REFERENCES parts(part_number)
);

INSERT INTO daily_schedule_rows_final
SELECT * FROM daily_schedule_rows;

DROP TABLE daily_schedule_rows;
ALTER TABLE daily_schedule_rows_final RENAME TO daily_schedule_rows;

CREATE INDEX ix_daily_schedules_plant_date
  ON daily_schedules (plant_id, schedule_date DESC, shift);

CREATE INDEX ix_daily_schedule_rows_plant_section
  ON daily_schedule_rows (plant_id, schedule_date DESC, shift, section_key, press);

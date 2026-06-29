-- 1. Create Parts Reference Table
CREATE TABLE IF NOT EXISTS parts (
  part_number TEXT PRIMARY KEY NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 2. Populate Parts table with unique entries from existing schedule rows
INSERT OR IGNORE INTO parts (part_number, description)
SELECT DISTINCT part_number, description 
FROM daily_schedule_rows 
WHERE part_number IS NOT NULL AND part_number != '';

-- 3. Create the normalized daily_schedule_rows table with correct foreign keys
CREATE TABLE daily_schedule_rows_new (
  daily_schedule_item_row_id TEXT PRIMARY KEY NOT NULL,
  daily_schedule_row_id TEXT NOT NULL, -- references daily_schedules
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
  shift TEXT,
  part_storage_location_json TEXT CHECK (part_storage_location_json IS NULL OR json_valid(part_storage_location_json)),
  raw_json TEXT CHECK (raw_json IS NULL OR json_valid(raw_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (plant_id, schedule_date, section_key, row_id),
  FOREIGN KEY (plant_id) REFERENCES plants(plant_id),
  FOREIGN KEY (daily_schedule_row_id) REFERENCES daily_schedules(daily_schedule_row_id) ON DELETE CASCADE,
  FOREIGN KEY (part_number) REFERENCES parts(part_number)
);

-- 4. Copy existing data into the normalized table, reconstructing the parent daily_schedule_row_id
INSERT INTO daily_schedule_rows_new (
  daily_schedule_item_row_id,
  daily_schedule_row_id,
  plant_id,
  schedule_date,
  section_key,
  row_id,
  press,
  part_number,
  cavity,
  doh,
  labels_per_shift,
  mc,
  notes,
  shift,
  part_storage_location_json,
  raw_json,
  created_at,
  updated_at
)
SELECT 
  daily_schedule_item_row_id,
  plant_id || ':' || schedule_date,
  plant_id,
  schedule_date,
  section_key,
  row_id,
  press,
  part_number,
  cavity,
  doh,
  labels_per_shift,
  mc,
  notes,
  shift,
  part_storage_location_json,
  raw_json,
  created_at,
  updated_at
FROM daily_schedule_rows;

-- 5. Swap old table with new table
DROP TABLE daily_schedule_rows;
ALTER TABLE daily_schedule_rows_new RENAME TO daily_schedule_rows;

-- 6. Recreate indexes for performance
CREATE INDEX IF NOT EXISTS ix_daily_schedule_rows_plant_section
  ON daily_schedule_rows (plant_id, schedule_date DESC, section_key, press);

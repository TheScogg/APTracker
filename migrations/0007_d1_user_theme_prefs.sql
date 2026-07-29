ALTER TABLE users
ADD COLUMN theme_prefs_json TEXT
CHECK (theme_prefs_json IS NULL OR json_valid(theme_prefs_json));

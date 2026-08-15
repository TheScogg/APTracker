-- Store each employee's preferred UI language on their user profile.
-- The JSON shape is versioned so additional locale preferences can be added later.

ALTER TABLE users ADD COLUMN language_prefs_json TEXT
  CHECK (language_prefs_json IS NULL OR json_valid(language_prefs_json));

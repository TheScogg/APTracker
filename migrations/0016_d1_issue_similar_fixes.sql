ALTER TABLE issues ADD COLUMN similar_fixes_json TEXT CHECK (similar_fixes_json IS NULL OR json_valid(similar_fixes_json));

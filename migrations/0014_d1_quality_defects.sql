ALTER TABLE issues ADD COLUMN quality_defect_json TEXT CHECK (quality_defect_json IS NULL OR json_valid(quality_defect_json));

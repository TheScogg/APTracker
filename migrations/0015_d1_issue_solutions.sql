ALTER TABLE issues ADD COLUMN solution_current_json TEXT CHECK (solution_current_json IS NULL OR json_valid(solution_current_json));
ALTER TABLE issue_attachments ADD COLUMN solution_revision_id TEXT;
CREATE INDEX IF NOT EXISTS ix_issue_attachments_solution_revision ON issue_attachments (issue_id, solution_revision_id, uploaded_at DESC);

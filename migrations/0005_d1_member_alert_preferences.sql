PRAGMA foreign_keys = ON;

-- Column additions below are already defined in 0001_d1_core.sql
-- ALTER TABLE plant_members ADD COLUMN alert_category_subscriptions_json TEXT CHECK (alert_category_subscriptions_json IS NULL OR json_valid(alert_category_subscriptions_json));
-- ALTER TABLE plant_members ADD COLUMN job_role_keys_json TEXT CHECK (job_role_keys_json IS NULL OR json_valid(job_role_keys_json));
-- ALTER TABLE plant_members ADD COLUMN job_feeds_json TEXT CHECK (job_feeds_json IS NULL OR json_valid(job_feeds_json));

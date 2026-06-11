ALTER TABLE users
ADD COLUMN global_xp_spent INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
ADD COLUMN inventory_json TEXT
CHECK (inventory_json IS NULL OR json_valid(inventory_json));

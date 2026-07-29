ALTER TABLE role_feed_alerts
ADD COLUMN notification_delivery_json TEXT CHECK (notification_delivery_json IS NULL OR json_valid(notification_delivery_json));

ALTER TABLE conversation_messages
ADD COLUMN notification_delivery_json TEXT CHECK (notification_delivery_json IS NULL OR json_valid(notification_delivery_json));

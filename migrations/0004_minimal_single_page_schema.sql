PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS idx_relay_items_content_fingerprint;
DROP INDEX IF EXISTS idx_relay_items_last_seen_at;
DROP INDEX IF EXISTS idx_relay_items_last_relayed_at;

CREATE TABLE IF NOT EXISTS relay_items_v3 (
  item_id INTEGER PRIMARY KEY,
  create_time TEXT NOT NULL,
  update_time TEXT NOT NULL,
  normalized_source_fingerprint TEXT NOT NULL,
  discord_message_id TEXT NOT NULL,
  relay_status TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_relayed_at TEXT NOT NULL
) STRICT;

INSERT INTO relay_items_v3 (
  item_id,
  create_time,
  update_time,
  normalized_source_fingerprint,
  discord_message_id,
  relay_status,
  last_seen_at,
  last_relayed_at
)
SELECT
  item_id,
  create_time,
  update_time,
  content_fingerprint,
  discord_message_id,
  CASE
    WHEN relay_status = 'updated' THEN 'updated'
    ELSE 'created'
  END,
  last_seen_at,
  last_relayed_at
FROM relay_items
WHERE relay_status != 'deduped';

DROP TABLE IF EXISTS relay_items;
ALTER TABLE relay_items_v3 RENAME TO relay_items;

CREATE INDEX IF NOT EXISTS idx_relay_items_last_seen_at
  ON relay_items(last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_relay_items_last_relayed_at
  ON relay_items(last_relayed_at DESC);

PRAGMA foreign_keys = ON;

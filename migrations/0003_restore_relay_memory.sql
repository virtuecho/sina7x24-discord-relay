PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS idx_relay_items_content_fingerprint;
DROP INDEX IF EXISTS idx_relay_items_last_seen_at;
DROP INDEX IF EXISTS idx_relay_items_last_relayed_at;

CREATE TABLE IF NOT EXISTS relay_items_v2 (
  item_id INTEGER PRIMARY KEY,
  zhibo_id INTEGER NOT NULL,
  create_time TEXT NOT NULL,
  update_time TEXT NOT NULL,
  headline TEXT NOT NULL,
  source TEXT NOT NULL,
  tag_names TEXT NOT NULL,
  doc_url TEXT NOT NULL,
  normalized_content TEXT NOT NULL,
  content_fingerprint TEXT NOT NULL,
  discord_message_id TEXT NOT NULL,
  last_content_hash TEXT NOT NULL,
  relay_status TEXT NOT NULL,
  duplicate_of_item_id INTEGER,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_relayed_at TEXT NOT NULL
) STRICT;

INSERT INTO relay_items_v2 (
  item_id,
  zhibo_id,
  create_time,
  update_time,
  headline,
  source,
  tag_names,
  doc_url,
  normalized_content,
  content_fingerprint,
  discord_message_id,
  last_content_hash,
  relay_status,
  duplicate_of_item_id,
  first_seen_at,
  last_seen_at,
  last_relayed_at
)
SELECT
  item_id,
  0,
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  last_content_hash,
  discord_message_id,
  last_content_hash,
  'created',
  NULL,
  last_relayed_at,
  last_relayed_at,
  last_relayed_at
FROM relay_items;

DROP TABLE IF EXISTS relay_items;
ALTER TABLE relay_items_v2 RENAME TO relay_items;

CREATE INDEX IF NOT EXISTS idx_relay_items_content_fingerprint
  ON relay_items(content_fingerprint);

CREATE INDEX IF NOT EXISTS idx_relay_items_last_seen_at
  ON relay_items(last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_relay_items_last_relayed_at
  ON relay_items(last_relayed_at DESC);

PRAGMA foreign_keys = ON;

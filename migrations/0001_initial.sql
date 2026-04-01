PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS relay_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS relay_items (
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

CREATE INDEX IF NOT EXISTS idx_relay_items_content_fingerprint
  ON relay_items(content_fingerprint);

CREATE INDEX IF NOT EXISTS idx_relay_items_last_seen_at
  ON relay_items(last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_relay_items_last_relayed_at
  ON relay_items(last_relayed_at DESC);

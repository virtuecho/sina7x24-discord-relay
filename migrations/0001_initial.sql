PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS relay_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS relay_items (
  item_id INTEGER PRIMARY KEY,
  create_time TEXT NOT NULL,
  update_time TEXT NOT NULL,
  normalized_source_fingerprint TEXT NOT NULL,
  discord_message_id TEXT NOT NULL,
  relay_status TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_relayed_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_relay_items_last_seen_at
  ON relay_items(last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_relay_items_last_relayed_at
  ON relay_items(last_relayed_at DESC);

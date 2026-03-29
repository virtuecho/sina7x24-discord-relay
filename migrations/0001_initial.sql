PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS relay_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS relay_items (
  item_id INTEGER PRIMARY KEY,
  discord_message_id TEXT NOT NULL,
  last_content_hash TEXT NOT NULL,
  last_relayed_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_relay_items_last_relayed_at
  ON relay_items(last_relayed_at DESC);

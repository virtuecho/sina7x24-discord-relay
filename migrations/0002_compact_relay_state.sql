PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS idx_relay_runs_started_at;
DROP INDEX IF EXISTS idx_relay_items_last_relayed_at;

CREATE TABLE IF NOT EXISTS relay_items_compact (
  item_id INTEGER PRIMARY KEY,
  discord_message_id TEXT NOT NULL,
  last_content_hash TEXT NOT NULL,
  last_relayed_at TEXT NOT NULL
) STRICT;

INSERT INTO relay_items_compact (
  item_id,
  discord_message_id,
  last_content_hash,
  last_relayed_at
)
SELECT
  item_id,
  discord_message_id,
  last_content_hash,
  last_relayed_at
FROM relay_items;

DROP TABLE IF EXISTS relay_items;
ALTER TABLE relay_items_compact RENAME TO relay_items;

DROP TABLE IF EXISTS relay_runs;

CREATE INDEX IF NOT EXISTS idx_relay_items_last_relayed_at
  ON relay_items(last_relayed_at DESC);

PRAGMA foreign_keys = ON;

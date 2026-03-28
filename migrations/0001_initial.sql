PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS relay_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS relay_runs (
  run_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  trigger_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
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
  discord_message_id TEXT NOT NULL,
  discord_channel_id TEXT NOT NULL,
  last_content_hash TEXT NOT NULL,
  relay_status TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_relayed_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_relay_runs_started_at
  ON relay_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_relay_items_last_relayed_at
  ON relay_items(last_relayed_at DESC);

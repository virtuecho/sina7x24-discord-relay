# Sina 7x24 Discord Relay

[中文说明](./README.zh-CN.md)

Sina 7x24 Discord Relay is a standalone Cloudflare Worker that polls the Sina Finance 7x24 feed, relays new items to Discord, and persists relay state in D1.

It is the extraction of the browser-side Discord auto-relay from the main `sina7x24` viewer project into a Worker-oriented service.

## Features

- Poll the Sina 7x24 feed from a scheduled Worker or a manual admin endpoint
- Add light jitter and browser-like request headers so polling does not look perfectly mechanical
- Send new feed items to Discord through a secret-managed webhook
- Update existing Discord messages when an already-relayed feed item changes
- Persist relay cursor, one latest run summary, and relay memory needed for item-level and content-level deduplication in D1
- Prevent overlapping runs with a D1-backed run lock
- Prune relay memory that has not been seen again for 7 days
- Expose admin endpoints for status inspection and manual runs
- Seed the relay cursor on first run instead of flooding Discord with backlog history

## Project Structure

- `src/index.js` — Worker entry with HTTP and scheduled handlers
- `src/config.js` — environment parsing and runtime defaults
- `src/http.js` — JSON responses, auth checks, and timeout helpers
- `src/sina.js` — Sina feed fetching and pagination
- `src/discord.js` — Discord webhook validation and delivery
- `src/store.js` — D1 persistence for cursor, run lock, and relayed-item memory
- `src/relay.js` — end-to-end relay orchestration
- `migrations/0001_initial.sql` — initial D1 schema for fresh installs
- `migrations/0002_compact_relay_state.sql` — upgrade migration for existing deployments
- `migrations/0003_restore_relay_memory.sql` — upgrade migration from the compact schema to the richer relay memory schema
- `wrangler.jsonc` — Wrangler configuration template
- `ARCHITECTURE.md` — system design and data-flow notes

## Requirements

- Node.js 18 or newer
- A Cloudflare account
- A D1 database bound to the Worker as `DB`
- A Discord webhook stored as the `DISCORD_WEBHOOK_URL` secret

## Local Development

Install dependencies:

```bash
npm install
```

Run syntax checks:

```bash
npm run check
```

Start local development with Wrangler:

```bash
npm run dev
```

## D1 Setup

Create a D1 database:

```bash
npx wrangler d1 create sina7x24-discord-relay
```

Add the generated binding to `wrangler.jsonc` as `DB`, then initialize the schema locally:

```bash
npx wrangler d1 execute sina7x24-discord-relay --local --file=./migrations/0001_initial.sql
```

Apply the same schema remotely:

```bash
npx wrangler d1 execute sina7x24-discord-relay --remote --file=./migrations/0001_initial.sql
```

If you are upgrading an existing deployment that already uses the compact schema introduced after `afd9e3b`, run:

```bash
npx wrangler d1 execute sina7x24-discord-relay --remote --file=./migrations/0003_restore_relay_memory.sql
```

If you are upgrading from the very first pre-compact schema, run both upgrade migrations in order:

```bash
npx wrangler d1 execute sina7x24-discord-relay --remote --file=./migrations/0002_compact_relay_state.sql
npx wrangler d1 execute sina7x24-discord-relay --remote --file=./migrations/0003_restore_relay_memory.sql
```

## Secrets And Vars

Set the required secrets:

```bash
npx wrangler secret put DISCORD_WEBHOOK_URL
npx wrangler secret put ADMIN_API_TOKEN
```

Optional local-only development values can be copied from `.dev.vars.example`.

`wrangler.jsonc` already includes these non-secret defaults:

- `SINA_ZHIBO_ID=152`
- `SINA_PAGE_SIZE=30`
- `SINA_PAGE_SIZE_JITTER=6`
- `MAX_PAGES_PER_RUN=3`
- `SINA_REQUEST_DELAY_MAX_MS=800`
- `SCHEDULE_JITTER_MAX_MS=12000`
- `RUN_LOCK_TTL_MS=240000`
- `RELAY_ITEM_RETENTION_DAYS=7`
- `DISCORD_USERNAME=新浪财经7x24`
- `ALLOW_UNAUTHENTICATED_ADMIN=false`

To enable scheduled polling after D1 and secrets are configured, uncomment the `triggers.crons` block in `wrangler.jsonc`.

## HTTP Endpoints

- `GET /healthz` — public health response
- `GET /api/status` — admin-only status snapshot
- `POST /api/run` — admin-only manual relay run

Use `Authorization: Bearer <ADMIN_API_TOKEN>` for admin endpoints unless you intentionally enable unauthenticated local admin mode.

## First Run Behavior

The first successful relay run records the newest feed item ID as the cursor and does not backfill old messages to Discord. That keeps a fresh deployment from flooding the channel with history.

The Worker stores only the latest run summary plus relay memory that is useful for deduplication. Cleanup still runs automatically, but it deletes records that have not been seen again for 7 days, rather than rows that were merely not re-relayed for 7 days.

## Related Docs

- [ARCHITECTURE.md](./ARCHITECTURE.md)

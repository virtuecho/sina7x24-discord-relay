# Architecture

## Current State

This repository starts from a minimal Cloudflare Worker scaffold:

- `src/index.js` — Worker entry
- `wrangler.jsonc` — Wrangler configuration
- `README.md` / `README.zh-CN.md` — project overview

## Next Step

The relay implementation on `codex/develop` will add:

- scheduled feed polling
- Discord webhook delivery
- persistent relay state
- admin and inspection endpoints

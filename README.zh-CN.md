# 新浪财经 7x24 Discord Relay

[English README](./README.md)

Sina 7x24 Discord Relay 是一个独立的 Cloudflare Worker，用来轮询新浪财经 7x24 数据流、把新消息转发到 Discord，并把 relay 状态持久化到 D1。

它把主仓库 `sina7x24` 里原本浏览器侧的 Discord 自动转发逻辑，拆成了一套独立的 Worker 服务。

## 功能

- 通过定时 Worker 或手动管理接口轮询新浪财经 7x24 数据流
- 在轮询时加入轻量抖动和更像浏览器的请求头，避免请求画像过于机械
- 通过 Secret 管理的 Discord Webhook 发送新消息
- 当已转发过的新闻内容发生变化时，更新已有的 Discord 消息
- 用 D1 持久化 relay 游标、最新一次运行摘要，以及支撑 item 级和内容级去重的 relay 记忆
- 用 D1 状态锁防止任务重叠执行
- 自动删除连续 7 天都没再见过的 `relay_items` 记录
- 提供状态查看和手动执行的管理接口
- 首次运行只种下游标，不会把历史消息整批灌入 Discord

## 项目结构

- `src/index.js` — Worker 入口，包含 HTTP 与 scheduled handler
- `src/config.js` — 环境变量解析和运行时默认值
- `src/http.js` — JSON 响应、鉴权检查和超时辅助
- `src/sina.js` — 新浪数据拉取与分页逻辑
- `src/discord.js` — Discord Webhook 校验与投递
- `src/store.js` — D1 中的游标、运行锁和 relay 记忆存储
- `src/relay.js` — 端到端 relay 编排逻辑
- `migrations/0001_initial.sql` — 全新部署的初始 D1 Schema
- `migrations/0002_compact_relay_state.sql` — 现有部署升级到精简 schema 的迁移脚本
- `migrations/0003_restore_relay_memory.sql` — 从 compact schema 升级到更完整 relay 记忆 schema 的迁移脚本
- `wrangler.jsonc` — Wrangler 配置模板
- `ARCHITECTURE.md` — 系统设计与数据流说明

## 环境要求

- Node.js 18 或更高版本
- Cloudflare 账号
- 绑定为 `DB` 的 D1 数据库
- 作为 `DISCORD_WEBHOOK_URL` Secret 存储的 Discord Webhook

## 本地开发

安装依赖：

```bash
npm install
```

运行语法检查：

```bash
npm run check
```

用 Wrangler 启动本地开发：

```bash
npm run dev
```

## D1 配置

创建 D1 数据库：

```bash
npx wrangler d1 create sina7x24-discord-relay
```

把生成的绑定信息写入 `wrangler.jsonc`，绑定名使用 `DB`，然后先在本地初始化 Schema：

```bash
npx wrangler d1 execute sina7x24-discord-relay --local --file=./migrations/0001_initial.sql
```

再把同一份 Schema 应用到远端：

```bash
npx wrangler d1 execute sina7x24-discord-relay --remote --file=./migrations/0001_initial.sql
```

如果你当前部署的是 `afd9e3b` 之后的 compact schema，还需要执行：

```bash
npx wrangler d1 execute sina7x24-discord-relay --remote --file=./migrations/0003_restore_relay_memory.sql
```

如果你是从最早那版 pre-compact schema 升级，需要按顺序执行两份升级 migration：

```bash
npx wrangler d1 execute sina7x24-discord-relay --remote --file=./migrations/0002_compact_relay_state.sql
npx wrangler d1 execute sina7x24-discord-relay --remote --file=./migrations/0003_restore_relay_memory.sql
```

## Secrets 与 Vars

设置必需的 Secret：

```bash
npx wrangler secret put DISCORD_WEBHOOK_URL
npx wrangler secret put ADMIN_API_TOKEN
```

本地开发可选变量可以参考 `.dev.vars.example`。

`wrangler.jsonc` 里已经带了这些非敏感默认值：

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

等 D1 和 Secrets 都配置好之后，再取消 `wrangler.jsonc` 里 `triggers.crons` 的注释即可启用定时轮询。

## HTTP 接口

- `GET /healthz` — 公开健康检查
- `GET /api/status` — 需要管理员权限的状态快照
- `POST /api/run` — 需要管理员权限的手动 relay 执行

管理接口默认使用 `Authorization: Bearer <ADMIN_API_TOKEN>` 鉴权；只有在你明确开启本地免鉴权模式时才可以不带令牌访问。

## 首次运行行为

第一次成功执行 relay 时，系统只会记录当前最新新闻 ID 作为游标，不会把更早的历史消息批量发到 Discord，避免新部署时刷屏。

Worker 只保留最新一次运行摘要，以及对去重仍然有价值的 relay 记忆。清理机制仍然会自动执行，但删除条件改成“连续 7 天都没再见过”，而不是“7 天没再次转发过”。

## 相关文档

- [ARCHITECTURE.md](./ARCHITECTURE.md)

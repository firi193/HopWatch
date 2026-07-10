# HopWatch

Prompt injection detection and monitoring for AI agent pipelines.

HopWatch sits in an agent chain and watches what external content agents fetch and what tools they call. It screens content in milliseconds, records the causal chain across hops, and uses an LLM judge to reason about whether a session looks like an attack.

**MVP mode is detection-only** — the agent always receives sanitized content; HopWatch never blocks execution.

## How it works

```
Agent fetches external content
        │
        ▼
  POST /analyze  or  @analyzeExternal
        │
        ▼
  StackOne Defender (Tier 1 patterns + Tier 2 ML)
        │
        ├─► Return sanitized content (~5ms hot path)
        ├─► Write detection to Postgres (async)
        ├─► Archive raw content to disk (async)
        ├─► Enqueue to BullMQ (async)
        └─► Slack alert if tier2_score > 0.7 (async)

Agent tool calls
        │
        ▼
  POST /action  or  @recordAction
        │
        └─► Write to Postgres + Redis action list

Queue worker (separate process)
        │
        ▼
  Batch detections by session → Gemini 2.5 Pro Judge
        │
        ├─► Write verdict to Postgres
        └─► Slack alert on injection or novel pattern
```

### Two-tier detection

| Tier | What | When |
|---|---|---|
| **Defender** (sync) | Pattern matching + ML scoring via `@stackone/defender` | Every `/analyze` call |
| **Judge LLM** (async) | Gemini 2.5 Pro reasons across hops, tool history, and prior session summaries | Worker batches from queue |

### Queue routing

Detections are routed to one of two BullMQ queues:

| Lane | Trigger |
|---|---|
| `judge-high` | `tier2_score ≥ 0.7`, or low score with escalation signals (novel source, upstream flags, instruction-like text) |
| `judge-medium` | Mid-range scores, or low scores without escalation |

The high lane flushes when 10 jobs accumulate (or after a 5-minute stale guard). The medium lane flushes every 15 minutes.

## Stack

| Layer | Technology |
|---|---|
| HTTP server | Hono + `@hono/node-server` |
| Defender | `@stackone/defender` (in-process) |
| Database | PostgreSQL 17, Drizzle ORM, postgres.js |
| Queue | BullMQ (Redis-backed) |
| Judge LLM | Gemini 2.5 Pro via `@google/genai` |
| Cache | Redis 7 via ioredis |
| Validation | Zod |
| Logging | Pino |
| Runtime | Node.js 22+ LTS, TypeScript 6, pnpm |

## Prerequisites

- [Node.js](https://nodejs.org/) 22 or later
- [pnpm](https://pnpm.io/)
- [Docker](https://www.docker.com/) (for Postgres and Redis)

## Quick start

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum `GEMINI_API_KEY` (required for the queue worker / Judge LLM). `SLACK_WEBHOOK_URL` is optional — alerts are suppressed if unset.

### 3. Start infrastructure

```bash
docker compose up -d
```

This starts:

- **Postgres 17** on `localhost:5432` (user / password / database: `hopwatch`)
- **Redis 7** on `localhost:6379`

### 4. Run migrations

```bash
pnpm db:migrate
```

Creates three tables: `detections`, `verdicts`, and `agent_actions`.

### 5. Start the services

HopWatch runs as two Node processes:

```bash
# Terminal 1 — HTTP API
pnpm dev

# Terminal 2 — queue worker (Judge LLM)
pnpm worker
```

The API listens on port `3000` by default.

### 6. Verify

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://hopwatch:hopwatch@localhost:5432/hopwatch` | Postgres connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `GEMINI_API_KEY` | — | Required for the Judge LLM worker |
| `SLACK_WEBHOOK_URL` | — | Slack incoming webhook; alerts skipped if empty |
| `TIER2_HIGH_THRESHOLD` | `0.7` | Score above this → high queue + sync Defender alert |
| `TIER2_MEDIUM_THRESHOLD` | `0.3` | Score above this → session flagged for upstream hops |
| `CONTENT_ARCHIVE_DIR` | `./data/archive` | Local directory for raw content archive |
| `PORT` | `3000` | HTTP server port |
| `DISABLE_TIER2` | `true` in `.env.example` | Skip ML scoring; Tier 1 patterns still run, `tier2_score` is `null` |

Set `DISABLE_TIER2=false` in production once `onnxruntime-node` is available. Tier 2 model warmup happens at server startup and may take a few seconds on first boot.

## API

### `GET /health`

Returns `{ "status": "ok" }`.

### `POST /analyze`

Screen external content through Defender. Returns sanitized content immediately; storage and queue writes are fire-and-forget.

**Request:**

```json
{
  "content": "raw external content (any JSON value)",
  "agent_id": "my-agent",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "hop": 0,
  "source_url": "https://example.com/page",
  "source_type": "web"
}
```

`session_id` must be a UUID. `hop` starts at 0 and increments at each agent boundary.

**Response:**

```json
{
  "sanitized": {},
  "tier2_score": 0.12,
  "max_sentence": null,
  "allowed": true,
  "sentences_removed": false,
  "detection_id": "uuid"
}
```

### `POST /action`

Record a tool call. Always returns `200` — storage errors are logged, never surfaced to the caller.

**Request:**

```json
{
  "tool_name": "sendEmail",
  "agent_id": "my-agent",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "hop": 0
}
```

## In-process decorators

For TypeScript agents running in the same process, use decorators instead of HTTP:

```ts
import { analyzeExternal } from "./interceptor/analyze.js";
import { recordAction } from "./interceptor/action.js";
import { generateSessionId } from "./interceptor/session.js";

const sessionId = generateSessionId();

class MyAgent {
  @analyzeExternal({ sessionId, hop: 0, agentId: "agent-1", sourceType: "email" })
  async fetchEmail(id: string) {
    return await gmailApi.get(id);
  }

  @recordAction({ sessionId, hop: 0, agentId: "agent-1" })
  async sendEmail(args: SendEmailArgs) {
    return await gmailApi.send(args);
  }
}
```

Both decorators call the same pipeline as the HTTP routes. `@analyzeExternal` returns sanitized content (and attaches `_detection_id` to object results). `@recordAction` derives `tool_name` from the method name and records before execution.

## Session model

- **`session_id`** — UUID that threads across all agents in a chain. Generated once by the caller (`generateSessionId()`); never auto-generated inside handlers.
- **`hop`** — Integer starting at 0, incremented at each agent boundary. The caller is responsible for threading both values through the chain.

Together with `agent_actions`, this enables full causal chain reconstruction per session.

## Alerting

Two Slack alert paths (via webhook):

| Path | Trigger | Timing | Severity |
|---|---|---|---|
| Defender | `tier2_score > TIER2_HIGH_THRESHOLD` | Sync during `/analyze` | High |
| Judge | Verdict is `injection`, or `novelty_flag = true` | Async after verdict write | Critical / Medium |

## Project structure

```
src/
├── index.ts              # HTTP server entry point
├── db/                   # Drizzle schema and client
├── interceptor/          # Core pipelines, decorators, Defender wrapper
├── routes/               # Hono route handlers (/analyze, /action)
├── queue/                # BullMQ client, router, worker
├── judge/                # Gemini Judge LLM invocation
├── alerting/             # Slack alert builders
└── lib/                  # Logger, Redis client
```

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start HTTP server with hot reload |
| `pnpm worker` | Start queue worker (Judge LLM) |
| `pnpm build` | Compile TypeScript |
| `pnpm test` | Run tests (Vitest) |
| `pnpm db:generate` | Generate Drizzle migrations from schema changes |
| `pnpm db:migrate` | Apply pending migrations |

## Troubleshooting

**Docker connection refused** — Start Docker Desktop, then `docker compose up -d`.

**Database connection errors** — Wait a few seconds after `docker compose up` before running `pnpm db:migrate`.

**Tier 2 / ONNX errors** — Set `DISABLE_TIER2=true`. Tier 1 pattern matching still runs.

**Judge never runs** — Confirm `pnpm worker` is running and `GEMINI_API_KEY` is set. Low-risk detections on the medium queue batch every 15 minutes.

**No Slack alerts** — Expected when `SLACK_WEBHOOK_URL` is unset.

## License

ISC

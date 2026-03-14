# API Reference

mini-agent exposes an HTTP API (Express) for managing the agent. All endpoints are served on the configured port (default `3001`).

## Authentication

Set `MINI_AGENT_API_KEY` environment variable to enable API key authentication. When set, all requests must include the key via:

- Header: `X-API-Key: <key>`
- Query parameter: `?api_key=<key>`

If no API key is configured, all requests are allowed (local-only use).

---

## Tasks

Tasks are stored as checklist items in `HEARTBEAT.md`. The Task API provides a structured way to read and create tasks without editing the Markdown file directly.

### List Tasks

```
GET /tasks
```

Returns all tasks (both pending and completed) parsed from `HEARTBEAT.md`.

**Response:**

```json
{
  "tasks": [
    {
      "task": "Review PR #42",
      "schedule": "today",
      "completed": false
    },
    {
      "task": "Deploy v2.0",
      "completed": true
    }
  ]
}
```

Each task object contains:

| Field | Type | Description |
|-------|------|-------------|
| `task` | `string` | The task description |
| `schedule` | `string?` | Optional schedule/deadline (parsed from parentheses in the checklist item) |
| `completed` | `boolean` | Whether the task is checked off |

### Create Task

```
POST /tasks
```

Adds a new unchecked task to `HEARTBEAT.md`.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `task` | `string` | Yes | The task description |
| `schedule` | `string` | No | Optional schedule note (e.g. `"tomorrow"`, `"2026-03-20"`) |

**Example:**

```json
{
  "task": "Write integration tests for search",
  "schedule": "this week"
}
```

**Response:**

```json
{
  "success": true,
  "task": "Write integration tests for search",
  "schedule": "this week"
}
```

The task is appended to `HEARTBEAT.md` as:
```
- [ ] Write integration tests for search (this week) <!-- added: 2026-03-15T10:00:00.000Z -->
```

**Errors:**

| Status | Body | Condition |
|--------|------|-----------|
| `400` | `{ "error": "task is required" }` | Missing or non-string `task` field |

---

## Health & Status

### Health Check

```
GET /health
```

Returns agent health status including uptime, loop state, and notification stats.

### Agent Status

```
GET /status
```

Returns detailed agent status: mode, loop state, memory stats, cron queue, active lanes.

---

## Chat

### Send Message

```
POST /chat
```

Send a message to the agent and get a response.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | `string` | Yes | The message to send |

---

## Memory

### Read Memory

```
GET /memory
```

Returns the current memory context.

### Search Memory

```
GET /memory/search?q=<query>
```

Full-text search across memory files (FTS5 + grep fallback).

### Append Memory

```
POST /memory
```

Append an entry to memory.

---

## Heartbeat

### Read Heartbeat

```
GET /heartbeat
```

Returns raw `HEARTBEAT.md` content.

### Update Heartbeat

```
PUT /heartbeat
```

Replace `HEARTBEAT.md` content.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | `string` | Yes | New heartbeat content |

---

## Cron

### List Cron Tasks

```
GET /cron
```

### Add Cron Task

```
POST /cron
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schedule` | `string` | Yes | Cron expression (e.g. `"*/30 * * * *"`) |
| `task` | `string` | Yes | Task description |
| `enabled` | `boolean` | No | Whether the task is active (default: true) |

### Remove Cron Task

```
DELETE /cron/:index
```

### Reload Cron Tasks

```
POST /cron/reload
```

---

## Loop Control

### Loop Status

```
GET /loop/status
```

### Pause Loop

```
POST /loop/pause
```

### Resume Loop

```
POST /loop/resume
```

### Trigger Cycle

```
POST /loop/trigger
```

---

## Config

### Get Config

```
GET /config
```

### Update Config

```
PUT /config
```

### Reset Config

```
POST /config/reset
```

---

## Mode

### Get Mode

```
GET /api/mode
```

Returns current mode (`calm`, `reserved`, or `autonomous`).

### Set Mode

```
POST /api/mode
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mode` | `string` | Yes | One of: `calm`, `reserved`, `autonomous` |

---

## Events (SSE)

```
GET /api/events
```

Server-Sent Events stream for real-time updates. Event types include `trigger:*`, `action:*`, `log:*`, and `notification:*`.

---

## Team Chat Room

### Post Message

```
POST /api/room
```

### Read Messages

```
GET /api/room?date=YYYY-MM-DD&limit=N
```

### Stream Messages (SSE)

```
GET /api/room/stream
```

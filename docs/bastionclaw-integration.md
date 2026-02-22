# BastionClaw Integration for Mission Control

## Overview

Mission Control integrates with BastionClaw to automatically track agent tasks in real-time. When a BastionClaw agent runs (triggered by Telegram, WhatsApp, or scheduled tasks), tasks appear on the board and are tracked through completion with status updates and duration tracking.

**Key constraint:** No modifications to BastionClaw source code. Integration achieved entirely through a standalone watcher daemon that reads BastionClaw's logs and SQLite database.

## Architecture

```
BastionClaw Pino Logs → Watcher Daemon (tail) → HTTP POST → Convex HTTP Endpoint → Mutation → Real-time UI
BastionClaw SQLite DB → Watcher Daemon (read) ↗
```

**Why this approach:**
- BastionClaw runs agents inside Apple Containers with no external hook system
- Zero BastionClaw source changes — watcher reads existing log output and database
- Standalone process — runs as a macOS LaunchAgent alongside BastionClaw
- Captures user prompts from SQLite `messages` table
- Loose coupling — HTTP webhook between systems

## What We Track

| Feature | Description |
|---------|-------------|
| **Prompt Capture** | User prompts from SQLite become task titles and descriptions |
| **Duration Tracking** | Shows how long each agent run took |
| **Source Detection** | Messages from Telegram (`tg:*`) or WhatsApp show source prefix |
| **Agent Matching** | BastionClaw group names map to Mission Control agents |
| **Scheduled Tasks** | Cron/interval task runs tracked with their own lifecycle |
| **Response Capture** | Agent output text captured from logs |
| **Error Tracking** | Container errors and timeouts reported |

## What We Don't Track (vs OpenClaw)

- Individual tool usage events (no mid-run progress messages)
- Thinking indicators
- Document captures from write tool calls

## How It Works

1. **Watcher tails `~/bastionclaw/logs/bastionclaw.log`** — Pino pretty-printed log with ANSI colors
2. **Parses structured log messages** — extracts timestamp, level, message, and key-value continuation lines
3. **On "Spawning container agent"** — looks up group in SQLite for chat JID, reads recent prompt from `messages` table, POSTs `action: "start"`
4. **On "Agent output:"** — captures response text, associates with active container run
5. **On "Container completed"** — POSTs `action: "end"` with captured response
6. **On "Container exited with error"** — POSTs `action: "error"` with exit code and stderr
7. **On "Running scheduled task"** — reads task metadata from `scheduled_tasks` table, POSTs `action: "start"`

## Files

### Mission Control (this repo)

| File | Purpose |
|------|---------|
| `convex/schema.ts` | Tasks table with `sessionKey`, `runId`, `startedAt` fields |
| `convex/http.ts` | POST route `/bastionclaw/event` for webhook |
| `convex/bastionclaw.ts` | Mutations to create/update tasks, add comments, track duration |
| `convex/queries.ts` | Enriched queries with `lastMessageTime` for task cards |
| `hooks/bastionclaw/watcher.ts` | Standalone watcher daemon |
| `hooks/bastionclaw/install.sh` | LaunchAgent installer |

---

## Implementation Details

### Schema

**File: `convex/schema.ts`**

```typescript
tasks: defineTable({
  // ... existing fields
  sessionKey: v.optional(v.string()),
  runId: v.optional(v.string()),
  startedAt: v.optional(v.number()),
}),
```

### HTTP Endpoint

**File: `convex/http.ts`**

```typescript
http.route({
  path: "/bastionclaw/event",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    await ctx.runMutation(api.bastionclaw.receiveAgentEvent, body);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});
```

### Watcher Daemon

**File: `hooks/bastionclaw/watcher.ts`**

The watcher is a standalone Node.js process that:
- Tails BastionClaw's Pino log file using `fs.watch()`
- Parses pretty-printed log lines (strips ANSI, extracts message + key-value pairs)
- Opens BastionClaw's SQLite database in read-only mode for prompt extraction
- Tracks active container runs in memory
- POSTs webhook events to Mission Control's Convex endpoint

### Log Messages Tracked

| Log Message | Action |
|------------|--------|
| `"Processing messages"` | Noted (start follows on spawn) |
| `"Spawning container agent"` | `action: "start"` |
| `"Agent output: ..."` | Capture response text |
| `"Container completed"` | `action: "end"` |
| `"Container completed (streaming mode)"` | `action: "end"` |
| `"Container exited with error"` | `action: "error"` |
| `"Container timeout, stopping gracefully"` | `action: "error"` (timeout) |
| `"Running scheduled task"` | `action: "start"` (scheduled) |
| `"Task completed"` | `action: "end"` (scheduled) |
| `"Task failed"` | `action: "error"` (scheduled) |

---

## Configuration

### 1. Install the Watcher

```bash
bash hooks/bastionclaw/install.sh
```

Environment variables (set before running):
- `MISSION_CONTROL_URL` — Convex HTTP endpoint (default: `http://127.0.0.1:3211/bastionclaw/event`)
- `BASTIONCLAW_DIR` — BastionClaw root directory (default: `~/bastionclaw`)

### 2. Manual Run (for testing)

```bash
MISSION_CONTROL_URL="http://127.0.0.1:3211/bastionclaw/event" npx tsx hooks/bastionclaw/watcher.ts
```

### 3. LaunchAgent Management

```bash
# Stop
launchctl unload ~/Library/LaunchAgents/com.mission-control.bastionclaw-watcher.plist

# Start
launchctl load ~/Library/LaunchAgents/com.mission-control.bastionclaw-watcher.plist

# Check status
launchctl list com.mission-control.bastionclaw-watcher

# View logs
tail -f ~/Library/Logs/bastionclaw-watcher/stdout.log
```

---

## Webhook Payload

**Endpoint:** `POST /bastionclaw/event`

```typescript
{
  runId: string;           // Container name (e.g. "bastionclaw-main-1707825000")
  action: string;          // "start" | "end" | "error"
  sessionKey?: string;     // "bastionclaw:{group}" or "bastionclaw:task:{taskId}"
  agentId?: string;        // Group display name
  timestamp?: string;      // ISO timestamp
  prompt?: string;         // User's prompt (from SQLite)
  source?: string;         // "telegram" | "whatsapp" | "scheduled"
  response?: string;       // Agent's response (from logs)
  error?: string;          // Error message
  eventType?: string;      // Event type for debugging
}
```

---

## Task Lifecycle

### On Agent Start (container spawn)
1. Task created in "In Progress" column
2. Title set from summarized prompt (read from SQLite)
3. Source detected from chat JID pattern
4. Activity logged

### On Agent End (container completed)
1. Task moved to "Done" (or "Review" if response contains question)
2. Duration calculated
3. Completion comment with agent response
4. Activity logged

### On Error
1. Task moved to "Review"
2. Error comment with details (exit code, stderr, timeout)
3. Activity logged

---

## Agent Mapping

BastionClaw group names are matched to Mission Control agents by name. Create agents in Mission Control that match your BastionClaw group display names (from `registered_groups` table).

If no match is found, a system "BastionClaw" agent is created/used.

---

## Verification

1. Start Mission Control: `bun dev`
2. Start the watcher: `npx tsx hooks/bastionclaw/watcher.ts`
3. Send a message to your BastionClaw bot (Telegram/WhatsApp)
4. Verify in UI:
   - Task appears in "In Progress"
   - On completion, moves to "Done" with response
   - Source shows "telegram" or "whatsapp"

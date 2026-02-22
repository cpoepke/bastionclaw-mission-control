# BastionClaw Watcher

Standalone daemon that tails BastionClaw's logs and translates container lifecycle events into Mission Control webhook payloads.

## Quick Start

```bash
# Install as LaunchAgent (auto-starts on login)
bash hooks/bastionclaw/install.sh

# Or run manually for testing
npx tsx hooks/bastionclaw/watcher.ts
```

## How It Works

```
BastionClaw (Pino logs) → watcher.ts (tail + SQLite read) → HTTP POST → Convex → Real-time UI
```

The watcher:
1. Tails `~/bastionclaw/logs/bastionclaw.log` for container lifecycle events
2. Reads `~/bastionclaw/store/messages.db` (read-only) for prompt extraction and group metadata
3. POSTs webhook events to Mission Control's Convex HTTP endpoint

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MISSION_CONTROL_URL` | `http://127.0.0.1:3211/bastionclaw/event` | Convex HTTP endpoint |
| `BASTIONCLAW_DIR` | `~/bastionclaw` | BastionClaw root directory |

## LaunchAgent

After running `install.sh`, the watcher runs as:

```
~/Library/LaunchAgents/com.mission-control.bastionclaw-watcher.plist
```

Manage with:
```bash
launchctl unload ~/Library/LaunchAgents/com.mission-control.bastionclaw-watcher.plist  # stop
launchctl load ~/Library/LaunchAgents/com.mission-control.bastionclaw-watcher.plist    # start
```

Logs at: `~/Library/Logs/bastionclaw-watcher/`

## Events Tracked

| BastionClaw Log | Mission Control Action |
|-------------|----------------------|
| Spawning container agent | Task created (in_progress) |
| Agent output | Response captured |
| Container completed | Task done |
| Container error/timeout | Task moved to review |
| Running scheduled task | Scheduled task created |
| Task completed/failed | Scheduled task done/error |

#!/usr/bin/env bash
# BastionClaw Watcher — LaunchAgent Installer
# Usage: bash hooks/bastionclaw/install.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WATCHER_SCRIPT="$SCRIPT_DIR/watcher.ts"
PLIST_NAME="com.mission-control.bastionclaw-watcher"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
BASTIONCLAW_DIR="${BASTIONCLAW_DIR:-$HOME/bastionclaw}"
LOG_DIR="$HOME/Library/Logs/bastionclaw-watcher"

# Default URL — override with env var or edit after install
MISSION_CONTROL_URL="${MISSION_CONTROL_URL:-http://127.0.0.1:3211/bastionclaw/event}"

echo "Installing BastionClaw watcher daemon..."

# 1. Validate bastionclaw directory
if [ ! -d "$BASTIONCLAW_DIR" ]; then
  echo "  ERROR: BastionClaw directory not found: $BASTIONCLAW_DIR"
  echo "  Set BASTIONCLAW_DIR env var if BastionClaw is installed elsewhere."
  exit 1
fi
echo "  BastionClaw dir: $BASTIONCLAW_DIR"

# 2. Check dependencies
if ! command -v npx &>/dev/null; then
  echo "  ERROR: npx not found. Install Node.js >= 20."
  exit 1
fi

# 3. Install tsx if not available
if ! npx tsx --version &>/dev/null 2>&1; then
  echo "  Installing tsx..."
  npm install -g tsx
fi

# 4. Resolve tsx path
TSX_PATH="$(command -v tsx 2>/dev/null || npx which tsx 2>/dev/null || echo "$(npm root -g)/tsx/dist/esm/index.mjs")"
NODE_PATH="$(command -v node)"

# 5. Unload existing plist if present
if launchctl list "$PLIST_NAME" &>/dev/null 2>&1; then
  echo "  Unloading existing LaunchAgent..."
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi

# 6. Create log directory
mkdir -p "$LOG_DIR"

# 7. Write plist
mkdir -p "$(dirname "$PLIST_PATH")"
cat > "$PLIST_PATH" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>--import</string>
        <string>tsx</string>
        <string>${WATCHER_SCRIPT}</string>
    </array>

    <key>EnvironmentVariables</key>
    <dict>
        <key>MISSION_CONTROL_URL</key>
        <string>${MISSION_CONTROL_URL}</string>
        <key>BASTIONCLAW_DIR</key>
        <string>${BASTIONCLAW_DIR}</string>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    </dict>

    <key>KeepAlive</key>
    <true/>

    <key>RunAtLoad</key>
    <true/>

    <key>StandardOutPath</key>
    <string>${LOG_DIR}/stdout.log</string>

    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/stderr.log</string>

    <key>ThrottleInterval</key>
    <integer>10</integer>
</dict>
</plist>
PLISTEOF

echo "  Created plist: $PLIST_PATH"

# 8. Load the LaunchAgent
launchctl load "$PLIST_PATH"
echo "  Loaded LaunchAgent: $PLIST_NAME"

# 9. Verify
sleep 2
if launchctl list "$PLIST_NAME" &>/dev/null 2>&1; then
  echo ""
  echo "  Watcher is running."
  echo "  Logs: $LOG_DIR/stdout.log"
  echo "  URL:  $MISSION_CONTROL_URL"
else
  echo ""
  echo "  WARNING: LaunchAgent may not have started."
  echo "  Check: launchctl list $PLIST_NAME"
  echo "  Logs:  $LOG_DIR/stderr.log"
fi

echo ""
echo "To stop:   launchctl unload $PLIST_PATH"
echo "To restart: launchctl unload $PLIST_PATH && launchctl load $PLIST_PATH"
echo ""
echo "Done."

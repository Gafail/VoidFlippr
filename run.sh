#!/usr/bin/env bash
# VoidFlippr - local server launcher.
#
# Usage: ./run.sh [PORT]      (default 9865)
#
# Binds to 0.0.0.0 so other devices on the network can reach it, falls forward
# to the next free port if the requested one is busy, and prints the local and
# LAN URLs.

set -euo pipefail

PORT="${1:-9865}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST="${HOST:-0.0.0.0}"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js 18+ is required. Install it from https://nodejs.org" >&2
  exit 1
fi

# --- detect LAN IP (best-effort) --------------------------------------------

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo '(unavailable)')"
if [ -z "$LAN_IP" ]; then LAN_IP="(unavailable)"; fi

# --- is the port free? ------------------------------------------------------

is_port_in_use() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -E "[:.]${PORT}$" >/dev/null
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$PORT" -sTCP:LISTEN -P -n 2>/dev/null | grep -q LISTEN
  else
    return 1
  fi
}

if is_port_in_use; then
  echo "Warning: port $PORT is already in use. Trying $((PORT+1))..." >&2
  PORT=$((PORT+1))
fi

# --- cleanup on exit --------------------------------------------------------

cleanup() {
  echo ""
  echo "Stopping VoidFlippr..."
}
trap cleanup EXIT INT TERM

# --- build if needed --------------------------------------------------------

if [ -d "$SCRIPT_DIR/src" ]; then
  if [ ! -d "$SCRIPT_DIR/dist" ] || [ "$SCRIPT_DIR/src" -nt "$SCRIPT_DIR/dist" ]; then
    echo "==> Building dist/ (src/ is newer or dist/ is missing)"
    if [ -d "$SCRIPT_DIR/node_modules" ]; then
      (cd "$SCRIPT_DIR" && npm run --silent build:prod) || echo "  build failed - falling back to src/"
    else
      echo "  node_modules/ not installed; run 'npm install' for a bundled build."
    fi
  fi
fi

echo "==============================================="
echo "  VoidFlippr - local server"
echo "  Node:      $(node --version)"
echo "  Serving:   $SCRIPT_DIR"
echo "  Binding:   $HOST:$PORT"
echo "-----------------------------------------------"
echo "  Local:     http://localhost:$PORT/"
echo "  LAN:       http://$LAN_IP:$PORT/"
echo "  Daily:     http://$LAN_IP:$PORT/daily-seed"
echo "==============================================="
echo "  Ctrl-C to stop."
echo ""

cd "$SCRIPT_DIR"
PORT="$PORT" HOST="$HOST" exec node server.js
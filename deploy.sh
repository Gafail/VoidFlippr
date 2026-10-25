#!/usr/bin/env bash
# VoidFlippr - deploy script.
# Run on the server. Syncs ./deploy/ -> /opt/voidflippr/, installs configs,
# reloads systemd + nginx, runs a smoke test.
#
# Usage:
#   ./deploy.sh                 # deploy to /opt/voidflippr/
#   ./deploy.sh /custom/path    # deploy to a custom path
#
# Requires sudo for the systemd + nginx reload steps.

set -euo pipefail

DEST="${1:-/opt/voidflippr}"
SRC="$(cd "$(dirname "$0")/deploy" 2>/dev/null && pwd || cd "$(dirname "$0")" && pwd)"

if [ ! -f "$SRC/server.js" ]; then
  echo "Error: $SRC/server.js not found. Run sync.sh first." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js 18+ is required on the server." >&2
  exit 1
fi

echo "==> Creating $DEST"
sudo mkdir -p "$DEST"

echo "==> Syncing $SRC -> $DEST"
sudo rsync -a --exclude='.git' --exclude='node_modules' "$SRC/" "$DEST/"
sudo chown -R voidflippr:voidflippr "$DEST"
sudo find "$DEST" -type d -exec chmod 755 {} \;
sudo find "$DEST" -type f -exec chmod 644 {} \;
sudo chmod +x "$DEST/run.sh" "$DEST/build.sh"

echo "==> Installing systemd unit"
sudo cp "$DEST/ops/systemd/voidflippr.service" /etc/systemd/system/voidflippr.service
sudo systemctl daemon-reload
sudo systemctl enable --now voidflippr

echo "==> Installing nginx configs"
sudo cp "$DEST/ops/nginx/voidflippr.conf"          /etc/nginx/sites-available/voidflippr
sudo cp "$DEST/ops/nginx/voidflippr-lan.conf"      /etc/nginx/sites-available/voidflippr-lan
sudo cp "$DEST/ops/nginx/voidflippr-internal.conf" /etc/nginx/sites-available/voidflippr-internal
sudo cp "$DEST/ops/nginx/voidflippr-cloudflare-ips.conf" /etc/nginx/snippets/voidflippr-cloudflare-ips.conf
sudo cp "$DEST/ops/nginx/voidflippr-realip.conf"            /etc/nginx/snippets/voidflippr-realip.conf

sudo ln -sf /etc/nginx/sites-available/voidflippr          /etc/nginx/sites-enabled/voidflippr
sudo ln -sf /etc/nginx/sites-available/voidflippr-lan      /etc/nginx/sites-enabled/voidflippr-lan
sudo ln -sf /etc/nginx/sites-available/voidflippr-internal /etc/nginx/sites-enabled/voidflippr-internal

echo "==> Reloading nginx"
if sudo nginx -t; then
  sudo systemctl reload nginx
else
  echo "  nginx config test FAILED - fix and reload manually" >&2
  exit 1
fi

echo "==> Smoke test"
SMOKE_BASE="${VOIDFLIPPR_SMOKE_BASE:-http://127.0.0.1:8080}"
for path in / /daily-seed /daily-leaderboard /healthz /404.html /this-does-not-exist; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${SMOKE_BASE}${path}" || echo "fail")
  echo "  $code  $path"
done

# POST smoke test for the submit endpoint (should reject garbage with 400).
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -X POST -H "Content-Type: application/json" -d '{}' "${SMOKE_BASE}/daily-submit")
echo "  $code  POST /daily-submit (empty body, expect 400)"

if [ -n "${VOIDFLIPPR_PUBLIC_URL:-}" ]; then
  echo "==> Public URL smoke test"
  for path in / /daily-seed /daily-leaderboard /healthz; do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${VOIDFLIPPR_PUBLIC_URL}${path}" || echo "fail")
    echo "  $code  $path  (public)"
  done
fi

echo "==> Done."
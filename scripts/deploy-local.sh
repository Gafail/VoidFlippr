#!/usr/bin/env bash
#
# Deploy VoidFlippr to the local LXC.
#
# Reads the connection details from .deploy-local/host.env (gitignored),
# runs the test suite, builds the frontend locally, pushes the deploy tree
# over SSH, and restarts the service inside the container.
#
#   ./scripts/deploy-local.sh
#
# The container needs Node.js 22.5+ and the systemd unit from
# ops/systemd/voidflippr.service installed once - see ops/RUNBOOK.md.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_FILE="$ROOT_DIR/.deploy-local/host.env"

if [ ! -f "$TARGET_FILE" ]; then
    echo "Error: $TARGET_FILE not found." >&2
    echo "Copy it from .deploy-local/host.env.example and fill in the host." >&2
    exit 1
fi

# shellcheck disable=SC1090
. "$TARGET_FILE"

: "${VH_HOST:?VH_HOST is not set in .deploy-local/host.env}"
: "${VH_USER:?VH_USER is not set in .deploy-local/host.env}"

VH_PORT="${VH_PORT:-22}"
VH_APP_DIR="${VH_APP_DIR:-/opt/voidflippr}"
VH_APP_PORT="${VH_APP_PORT:-9865}"
VH_KEY="${VH_KEY:-.deploy-local/id_ed25519}"

case "$VH_KEY" in
    /*) KEY_PATH="$VH_KEY" ;;
    *)  KEY_PATH="$ROOT_DIR/$VH_KEY" ;;
esac

SSH_OPTS=(-i "$KEY_PATH" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -p "$VH_PORT")
TARGET="$VH_USER@$VH_HOST"

cd "$ROOT_DIR"

echo "==> Running tests"
npm test

echo "==> Staging deploy tree (this also builds the production bundle)"
"$ROOT_DIR/sync.sh"

echo "==> Pushing to $TARGET:$VH_APP_DIR"
# data/ is excluded on purpose: the live leaderboard lives on the target and
# must never be wiped by a deploy. rsync does not delete excluded files.
rsync -az --delete --exclude 'data/' \
    -e "ssh -i '$KEY_PATH' -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -p $VH_PORT" \
    "$ROOT_DIR/deploy/" "$TARGET:$VH_APP_DIR/"

echo "==> Preparing the service"
# One-time setup, idempotent: create the service user and install the unit.
# Node.js 22.5+ must already be present in the container.
ssh "${SSH_OPTS[@]}" "$TARGET" "
    id -u voidflippr >/dev/null 2>&1 || \
        useradd -r -m -d '$VH_APP_DIR' -s /usr/sbin/nologin voidflippr
    install -m 0644 '$VH_APP_DIR/ops/systemd/voidflippr.service' \
        /etc/systemd/system/voidflippr.service
    chown -R voidflippr:voidflippr '$VH_APP_DIR'
    mkdir -p '$VH_APP_DIR/data'
    chown voidflippr:voidflippr '$VH_APP_DIR/data'
"

echo "==> Installing LXC-specific systemd overrides"
# The checked-in unit is written for a VPS: it binds 127.0.0.1 behind
# nginx. Inside the LXC the game is reached directly over the LAN, so:
#   - HOST=0.0.0.0        listen on the container's LAN address
#   - TRUST_PROXY=0       no proxy in front, so client IPs come from the socket
#   - STORAGE_BACKEND=json  the container is on a distributed filesystem
ssh "${SSH_OPTS[@]}" "$TARGET" "mkdir -p /etc/systemd/system/voidflippr.service.d && cat > /etc/systemd/system/voidflippr.service.d/override.conf" <<'EOF'
[Service]
Environment=HOST=0.0.0.0
Environment=TRUST_PROXY=0
Environment=STORAGE_BACKEND=json
EOF

echo "==> Restarting service"
ssh "${SSH_OPTS[@]}" "$TARGET" \
    "systemctl daemon-reload && systemctl enable voidflippr && systemctl restart voidflippr && sleep 2 && systemctl --no-pager --lines=0 status voidflippr"

echo
echo "==> Health check"
curl -fsS "http://$VH_HOST:$VH_APP_PORT/healthz" && echo
echo
echo "Deployed: http://$VH_HOST:$VH_APP_PORT/"

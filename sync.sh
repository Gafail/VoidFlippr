#!/usr/bin/env bash
# VoidFlippr - sync source files into a deployment tree.
# Run from the project root: ./sync.sh [/custom/deploy/path]
#
# Builds src/ -> dist/ and copies the source tree, the built artifacts and the
# ops/ configuration into the deploy folder, so the server can serve dist/
# directly without needing node_modules on the production box.
#
# This script only writes into the deploy staging folder. It never touches the
# running server - that is deploy.sh's job.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="${1:-$ROOT_DIR/deploy}"

# Build first so dist/ is up to date.
"$ROOT_DIR/build.sh" --prod

mkdir -p "$DEST"

# Top-level runtime files.
for f in server.js package.json package-lock.json 404.html run.sh build.sh build.mjs README.md LICENSE Dockerfile; do
  if [ -e "$ROOT_DIR/$f" ]; then
    cp -f "$ROOT_DIR/$f" "$DEST/$f"
  fi
done

# The server implementation.
if [ -d "$ROOT_DIR/server" ]; then
  rsync -a "$ROOT_DIR/server/" "$DEST/server/"
fi

# Shared logic used by both the client and the server.
if [ -d "$ROOT_DIR/shared" ]; then
  rsync -a "$ROOT_DIR/shared/" "$DEST/shared/"
fi

# Static site-root assets: icons, manifest, robots.txt.
if [ -d "$ROOT_DIR/public" ]; then
  rsync -a "$ROOT_DIR/public/" "$DEST/public/"
fi

# Ship src/ so future rebuilds on the server are possible.
if [ -d "$ROOT_DIR/src" ]; then
  rsync -a "$ROOT_DIR/src/" "$DEST/src/"
fi

# Ship dist/ - this is what the server actually serves.
if [ -d "$ROOT_DIR/dist" ]; then
  rsync -a "$ROOT_DIR/dist/" "$DEST/dist/"
fi

if [ -d "$ROOT_DIR/ops" ]; then
  rsync -a "$ROOT_DIR/ops/" "$DEST/ops/"
fi

# The data directory holds the live leaderboard. It is never copied: mount a
# volume at /data on the host instead, so scores survive a redeploy.
if [ -d "$DEST/data" ]; then
  echo "==> Removing live data/ from the deploy tree (use a mounted volume)"
  rm -rf "$DEST/data"
fi

# node_modules is never copied: the server has no runtime dependencies.

chmod +x "$DEST/run.sh" "$DEST/build.sh" 2>/dev/null || true

echo "Synced to $DEST/"
ls -la "$DEST/"
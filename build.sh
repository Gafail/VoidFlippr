#!/usr/bin/env bash
# VoidFlippr build wrapper.
#
# Usage:
#   ./build.sh           # dev build (readable output)
#   ./build.sh --prod    # production build (minified)
#
# Requires Node.js 18+. esbuild is a dev dependency; without it the build
# copies src/ as-is and the server runs straight from the source tree.

set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js 18+ is required." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "==> Installing dev dependencies"
  npm install --silent --no-audit --no-fund
fi

if [ "${1:-}" = "--prod" ]; then
  npm run --silent build:prod
else
  npm run --silent build
fi
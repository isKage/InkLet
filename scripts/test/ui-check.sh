#!/bin/bash
# Builds the frontend, serves it, and runs the interactive UI checks
# (scripts/test/ui-check.mjs) against it with headless Chrome.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${1:-8797}"

cd "$ROOT"
pnpm --filter @inklet/desktop run build >/dev/null

python3 -m http.server "$PORT" --directory apps/desktop/dist >/dev/null 2>&1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null || true' EXIT
sleep 1

node scripts/test/ui-check.mjs "http://127.0.0.1:$PORT" .cache/ui

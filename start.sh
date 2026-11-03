#!/usr/bin/env sh
# Shiv Sonography Clinic Suite — LAN server (Linux / macOS)
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install the LTS version from https://nodejs.org and run ./start.sh again."
  exit 1
fi
if ! node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=13)?0:1)"; then
  echo "WARNING: Node.js older than 22.13 — the built-in SQLite database is unavailable and a slower JSON store will be used."
  echo "Install the current LTS from https://nodejs.org for production use."
fi
if [ ! -d node_modules/express ]; then
  echo "Installing server components (first run only, needs internet)…"
  npm install --omit=dev --no-audit --no-fund || exit 1
fi
exec node --no-warnings server.js

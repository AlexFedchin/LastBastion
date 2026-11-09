#!/usr/bin/env bash
# Last Bastion - one-click launcher for macOS / Linux (needs Node.js 22+)
set -e
cd "$(dirname "$0")"
node scripts/prelaunch.mjs
npx electron . "$@"

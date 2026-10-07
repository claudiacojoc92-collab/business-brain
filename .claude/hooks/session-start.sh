#!/bin/bash
# SessionStart hook: install npm workspace dependencies so lint, type-check
# and tests work in Claude Code cloud sessions.
set -euo pipefail

# Only run in remote (cloud) sessions.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# `npm install` (not `npm ci`) reuses the cached node_modules; --no-save keeps
# package-lock.json untouched (it still lists apps/workers, which is not in the repo).
npm install --no-save --no-audit --no-fund --loglevel=error

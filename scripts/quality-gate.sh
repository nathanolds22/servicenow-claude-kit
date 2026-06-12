#!/usr/bin/env bash
# scripts/quality-gate.sh
#
# Adaptive end-of-session quality gate, wired to the Stop hook in
# .claude/settings.json. Runs ONLY the gates that exist in this repo, so the
# same script works for a fresh MCP-first clone and grows automatically when
# the project adopts more tooling (lint config, Fluent SDK, tests).
#
# Honours:
#   SKIP_QUALITY_GATE=1   skip entirely (with a log line)
#
# Exit code mirrors the first failing gate. Exits 0 when no gates apply.

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ "${SKIP_QUALITY_GATE:-}" == "1" ]]; then
    echo "[quality-gate] skipped (SKIP_QUALITY_GATE=1)"
    exit 0
fi

ran_any=0

has_npm_script() {
    node -e "process.exit(require('./package.json').scripts?.['$1'] ? 0 : 1)" 2>/dev/null
}

if has_npm_script lint; then
    echo "[quality-gate] npm run lint..."
    npm run --silent lint
    ran_any=1
fi

if has_npm_script lint:sanitize; then
    echo "[quality-gate] npm run lint:sanitize..."
    npm run --silent lint:sanitize
    ran_any=1
fi

if [[ -f now.config.json ]]; then
    echo "[quality-gate] now-sdk build (Fluent readiness scan)..."
    npx now-sdk build
    ran_any=1
fi

if [[ "$ran_any" == "0" ]]; then
    echo "[quality-gate] no gates configured yet (add lint / lint:sanitize npm scripts, or adopt Fluent) — OK"
else
    echo "[quality-gate] OK"
fi

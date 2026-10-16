#!/bin/bash
# Cloud sessions: nothing to install (static site, vendored supabase-js).
# Check the preinstalled tools that tools/check.sh relies on and point
# Playwright at the image's Chromium.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

missing=()
command -v node   >/dev/null || missing+=(node)
command -v eslint >/dev/null || missing+=(eslint)
[ -f /opt/node22/lib/node_modules/playwright/index.mjs ] || missing+=(playwright)
[ -d /opt/pw-browsers ] || missing+=(chromium)

if [ "${#missing[@]}" -gt 0 ]; then
  echo "session-start: missing ${missing[*]} — tools/check.sh won't fully run" >&2
fi

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers' >> "$CLAUDE_ENV_FILE"
  echo 'export PLAYWRIGHT_MODULE=/opt/node22/lib/node_modules/playwright/index.mjs' >> "$CLAUDE_ENV_FILE"
fi
echo "session-start: ready — run tools/check.sh for lint, syntax and smoke tests"

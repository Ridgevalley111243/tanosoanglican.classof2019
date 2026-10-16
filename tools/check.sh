#!/bin/bash
# Fast checks for this repo: lint + syntax-check every module, then a
# headless smoke run of the member and admin pages against fake data.
set -euo pipefail
cd "$(dirname "$0")/.."

eslint assets/js
for f in assets/js/*.js assets/js/views/*.js; do node --input-type=module --check < "$f"; done
echo "lint + syntax: ok"

out="${1:-$(mktemp -d)}"
mkdir -p "$out"
node tools/smoke.mjs "$out" anon home,register
node tools/smoke.mjs "$out" member home,pay,history,receipt/pay3,notices,account
node tools/smoke.mjs "$out" admin admin,admin/review,admin/members,admin/expenses,admin/reports,admin/settings,admin/audit
echo "smoke: ok (screenshots in $out)"

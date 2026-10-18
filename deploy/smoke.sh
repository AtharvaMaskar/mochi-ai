#!/usr/bin/env bash
# Build the image, start the prod stack, and expect 200 from every public route. Needs a filled .env.
# BASE=https://<app>.up.railway.app deploy/smoke.sh  checks a live deploy instead (no build).
set -uo pipefail
# /api/copilotkit/info is CopilotKit's health route (lists the mochi agent). /api/stories (list) lands with wire-ui.
cd "$(dirname "$0")/.."
BASE=${BASE:-}
if [[ -z $BASE ]]; then
  BASE=http://localhost:4100
  docker compose -f docker-compose.prod.yml up -d --build --wait falkordb app || exit 1
  for _ in $(seq 60); do curl -fs -o /dev/null "$BASE/blog" && break; sleep 1; done
fi
fail=0
for path in / /app/ /blog /api/stories /api/copilotkit/info; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$path")
  echo "$code $path"
  [[ $code == 200 ]] || fail=1
done
# The desk's own bundle must load from /app/assets/ (vite base).
asset=$(curl -s "$BASE/app/" | grep -o '/app/assets/[^"]*\.js' | head -1)
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$asset")
echo "$code ${asset:-<no /app/assets script in /app/>}"
[[ $code == 200 ]] || fail=1
exit $fail

#!/bin/zsh
# Safe deploy for a launchd-managed server on macOS (see README → "Run it as a service").
#   checks (typecheck, lint, unit tests) -> copy the tree into a fresh release dir (APFS clones) ->
#   build THERE -> switch $SYNC_LIVE_DIR/current -> restart -> health check.
# Env: SYNC_LIVE_DIR (default ~/sync-live), SYNC_LAUNCHD_LABEL (default local.sync-web), SYNC_PORT (3000).
# The live server never runs from this working tree, so builds made here for testing can't break it,
# and a failed build leaves the running release untouched.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=$PWD
LIVE=${SYNC_LIVE_DIR:-$HOME/sync-live}
LABEL=${SYNC_LAUNCHD_LABEL:-local.sync-web}
PORT=${SYNC_PORT:-3000}
REL=$LIVE/releases/$(date +%Y%m%d-%H%M%S)
echo "› typecheck"; npx tsc --noEmit
echo "› lint"; npx eslint --max-warnings=0 >/dev/null
echo "› unit tests"; npm test --silent >/dev/null
echo "› release $REL"
mkdir -p "$REL"
for f in src public scripts package.json package-lock.json next.config.ts tsconfig.json next-env.d.ts postcss.config.mjs .env.local; do
  [[ -e "$f" ]] && cp -cR "$f" "$REL/"
done
cp -cR node_modules "$REL/"
echo "› build"
(cd "$REL" && npm run build >"$REL/build.log" 2>&1) || { tail -30 "$REL/build.log"; echo "BUILD FAILED — live server untouched"; rm -rf "$REL"; exit 1; }
ln -sfn "$REL" "$LIVE/current.new" && mv -fh "$LIVE/current.new" "$LIVE/current"
echo "› restart"; launchctl kickstart -k "gui/$(id -u)/$LABEL"
for i in {1..20}; do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:$PORT/login || true)
  if [[ "$code" == "200" ]]; then
    echo "✓ live (HTTP 200) — $(basename "$REL")"
    # keep the 3 newest releases
    ls -1dt "$LIVE"/releases/*/ | tail -n +4 | while read -r old; do rm -rf "$old"; done
    exit 0
  fi
  sleep 1
done
echo "✗ server not healthy after restart (last HTTP $code) — check the service's log"; exit 1

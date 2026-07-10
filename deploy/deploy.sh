#!/usr/bin/env bash
#
# deploy/deploy.sh — redeploy the QuickCart API on the VPS after a git push
# to the deployed branch. Run as the non-root deploy user, from anywhere
# (it cd's into APP_DIR itself). Safe to re-run; aborts before touching the
# running process if any step fails (`set -e`), so a failed deploy leaves
# the previous PM2 process untouched and still serving traffic.
#
# Usage:
#   APP_DIR=/var/www/quickcart GIT_BRANCH=main ./deploy.sh
# (both have sane defaults matching setup-vps.sh, so bare `./deploy.sh`
# works on a box provisioned with that script)
#
# Called manually via SSH, or from the optional CI deploy job in
# .github/workflows/ci.yml.

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/quickcart}"
GIT_BRANCH="${GIT_BRANCH:-main}"
SERVER_DIR="$APP_DIR/server"
HEALTH_URL="http://127.0.0.1:${PORT:-4000}/health"

log() { echo "[deploy] $*"; }

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "[deploy] $APP_DIR is not a git checkout — run deploy/setup-vps.sh first." >&2
  exit 1
fi

log "1/6 git pull ($GIT_BRANCH)"
git -C "$APP_DIR" fetch origin
git -C "$APP_DIR" checkout "$GIT_BRANCH"
git -C "$APP_DIR" pull --ff-only origin "$GIT_BRANCH"

log "2/6 npm ci (server)"
( cd "$SERVER_DIR" && npm ci )

log "3/6 npm run build (server: tsc)"
( cd "$SERVER_DIR" && npm run build )

log "4/6 npm test (server: vitest+supertest) — deploy aborts if these fail"
if ! ( cd "$SERVER_DIR" && npm test ); then
  echo "[deploy] Tests FAILED. Aborting before touching the running PM2 process." >&2
  echo "[deploy] The previously running build is untouched and still serving traffic." >&2
  exit 1
fi

log "5/6 pm2 reload (zero-downtime, cluster mode)"
# --update-env picks up any change to the `env` block in ecosystem.config.js
# (server/.env itself is re-read by dotenv on process start regardless).
pm2 reload "$APP_DIR/deploy/ecosystem.config.js" --env production --update-env

log "6/6 health check ($HEALTH_URL) — retry for up to ~15s while the new worker(s) warm up"
ok=0
for i in $(seq 1 5); do
  if curl -fsS "$HEALTH_URL" >/dev/null; then
    ok=1
    break
  fi
  sleep 3
done

if [[ "$ok" -ne 1 ]]; then
  cat <<EOF >&2
[deploy] Health check FAILED after reload. The API may be down or crash-looping.
[deploy] Diagnose with:  pm2 logs quickcart-api --lines 100
[deploy] ROLLBACK (manual, on purpose — don't auto-rollback a payments API):
           git -C "$APP_DIR" log --oneline -5      # find the last-good commit
           git -C "$APP_DIR" checkout <good-sha>
           (cd "$SERVER_DIR" && npm ci && npm run build)
           pm2 reload "$APP_DIR/deploy/ecosystem.config.js" --env production --update-env
EOF
  exit 1
fi

log "Deploy OK — $HEALTH_URL responded healthy."
pm2 save

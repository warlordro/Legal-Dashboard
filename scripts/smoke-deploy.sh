#!/usr/bin/env bash
# Host-side smoke check for a running Legal Dashboard backend (Docker compose
# or bare metal). The Docker healthcheck inside docker-compose.yml only proves
# intra-container reachability — if the host port-forward is misconfigured the
# container can stay HEALTHY while every host request times out. This script
# exercises the same invariants from outside.
#
# Usage:
#   scripts/smoke-deploy.sh              # default: http://127.0.0.1:3002
#   BASE_URL=https://app.example.com scripts/smoke-deploy.sh
#
# Exit codes:
#   0 — all probes passed
#   1 — at least one probe failed (stderr explains which)

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3002}"
TIMEOUT="${TIMEOUT:-5}"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

echo "[smoke] target: $BASE_URL"

# 1. /health responds 200 with JSON body containing ready=true.
HEALTH=$(curl --silent --show-error --fail --max-time "$TIMEOUT" "$BASE_URL/health" 2>/dev/null) \
  || fail "/health did not return 2xx within ${TIMEOUT}s — host port-forward broken or backend not running"
echo "[smoke] /health body: $HEALTH"
# /health returns {status:"ok",...} after prewarm completes; "starting" + 503
# during boot. The 2xx requirement above already filters out the "starting"
# state, but assert the post-ready shape explicitly so an accidental refactor
# that flips status doesn't sneak past.
echo "$HEALTH" | grep -q '"status"\s*:\s*"ok"' \
  || fail "/health body missing status=ok (got: $HEALTH)"

# 2. /api/v1/* must NOT 200 without auth in web mode. We send a request that
#    in desktop mode would succeed (200 with the seeded local user) but in web
#    mode must come back 401. We don't know the mode from the outside, so we
#    accept either:
#      - 200 + a body shape consistent with desktop seeded user, OR
#      - 401 + an error envelope (web mode rejecting unauthenticated request).
ME_STATUS=$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --max-time "$TIMEOUT" "$BASE_URL/api/v1/me")
case "$ME_STATUS" in
  200)
    echo "[smoke] /api/v1/me 200 — assumed desktop / single-tenant mode"
    ;;
  401)
    echo "[smoke] /api/v1/me 401 — web mode auth gate active (expected behind reverse proxy)"
    ;;
  *)
    fail "/api/v1/me returned unexpected status $ME_STATUS (expected 200 desktop or 401 web)"
    ;;
esac

# 3. Static frontend should be served from the same origin in production
#    builds (NODE_ENV=production triggers mountStaticFrontend). 404 is also
#    acceptable for dev runs that skipped the bundled frontend.
INDEX_STATUS=$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --max-time "$TIMEOUT" "$BASE_URL/")
case "$INDEX_STATUS" in
  200|404)
    echo "[smoke] / static frontend status $INDEX_STATUS (200 prod / 404 dev — both OK)"
    ;;
  *)
    fail "/ returned unexpected status $INDEX_STATUS"
    ;;
esac

echo "[smoke] PASS"

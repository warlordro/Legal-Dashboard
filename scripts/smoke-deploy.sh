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
  302)
    echo "[smoke] /api/v1/me 302 — OAuth gate active (expected on the public HTTPS edge)"
    ;;
  *)
    fail "/api/v1/me returned unexpected status $ME_STATUS (expected 200 desktop, 401 web, 302 edge)"
    ;;
esac

# 3. PAT ingress (v2.40.1) — only meaningful against the PUBLIC HTTPS edge
#    (Caddy @pat route). An INVALID PAT must reach the backend and come back
#    401 JSON; a 302 means the request fell into the oauth2-proxy flow, i.e.
#    the ingress route is missing/broken. Skipped for direct-backend targets
#    (http://...) where oauth2-proxy is not in the path.
if [[ "$BASE_URL" == https://* ]]; then
  # Single request: status via --write-out (last line), headers via --dump-header
  # on stdout. Two separate curls could trip the backend per-IP rate limit on
  # invalid PATs and 429 the second probe.
  PAT_RESPONSE=$(curl --silent --output /dev/null --dump-header - --write-out '%{http_code}' \
    --max-time "$TIMEOUT" \
    -H "Authorization: Bearer ld_pat_smoke_invalid" \
    "$BASE_URL/api/dosare?numarDosar=smoke")
  PAT_STATUS=$(echo "$PAT_RESPONSE" | tail -n 1)
  PAT_HEADERS=$(echo "$PAT_RESPONSE" | sed '$d')
  case "$PAT_STATUS" in
    401)
      echo "[smoke] PAT ingress 401 — direct backend route active (expected)"
      ;;
    302)
      fail "PAT ingress returned 302 (OAuth redirect) — Caddy @pat route missing; PAT clients cannot reach the backend"
      ;;
    *)
      fail "PAT ingress returned unexpected status $PAT_STATUS (expected 401)"
      ;;
  esac
  # Site-level security headers must apply to the PAT handle too.
  echo "$PAT_HEADERS" | grep -qi 'strict-transport-security' \
    || fail "PAT ingress response missing Strict-Transport-Security header"
  echo "$PAT_HEADERS" | grep -qi 'x-content-type-options' \
    || fail "PAT ingress response missing X-Content-Type-Options header"
  echo "[smoke] PAT ingress security headers present"
else
  echo "[smoke] PAT ingress probe skipped (BASE_URL is not the public HTTPS edge)"
fi

# 4. Static frontend should be served from the same origin in production
#    builds (NODE_ENV=production triggers mountStaticFrontend). 404 is also
#    acceptable for dev runs that skipped the bundled frontend.
INDEX_STATUS=$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --max-time "$TIMEOUT" "$BASE_URL/")
case "$INDEX_STATUS" in
  200|404|302)
    echo "[smoke] / static frontend status $INDEX_STATUS (200 prod / 404 dev / 302 edge OAuth — all OK)"
    ;;
  *)
    fail "/ returned unexpected status $INDEX_STATUS"
    ;;
esac

echo "[smoke] PASS"

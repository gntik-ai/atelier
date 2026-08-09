#!/usr/bin/env bash
# Real-Keycloak-26 runner for the proofs that can only be settled against a real Keycloak:
#   - auth/ROPC user-profile relaxation (fix-auth-as-a-service-login #496)
#   - workspace_id attribute persistence + claim minting (#961)
# Brings up ONLY the tests/env Keycloak 26 service, waits for health, runs the suite.
#
#   bash tests/env/keycloak/run.sh
#
# Override the target with KC_BASE_URL / KC_ADMIN / KC_ADMIN_PASSWORD.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_DIR="$(cd "$HERE/.." && pwd)"
COMPOSE="docker compose -f $ENV_DIR/docker-compose.yml"

if [ -z "${KC_BASE_URL:-}" ]; then
  echo "==> starting tests/env Keycloak 26 (compose service: keycloak)"
  $COMPOSE up -d keycloak
  echo "==> waiting for Keycloak health"
  for _ in $(seq 1 60); do
    [ "$($COMPOSE ps --format '{{.Health}}' keycloak 2>/dev/null || true)" = "healthy" ] && break
    sleep 2
  done
  export KC_BASE_URL=http://localhost:8081
fi

echo "==> running real-Keycloak-26 identity tests"
node --test "$HERE"/*.test.mjs

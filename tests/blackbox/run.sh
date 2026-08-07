#!/usr/bin/env bash
# Black-box test entrypoint — runs the whole suite via Node.js built-in test runner.
# Exits non-zero on any failure and prints a readable summary.
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root
FILTER="${1:-}"

# SeaweedFS migration validation (change add-seaweedfs-migration-validation).
# Off by default so the suite is unchanged for the standard (MinIO) path; CI sets
# SEAWEEDFS_VALIDATION=1 + S3_ENDPOINT->SeaweedFS to gate the migration validation.
if [ "${SEAWEEDFS_VALIDATION:-}" = "1" ]; then
  echo "==> SEAWEEDFS_VALIDATION=1: running SeaweedFS migration validation" >&2
  bash "$(dirname "$0")/../env/validation/run-validation.sh" || exit 1
fi

# FerretDB migration validation (change add-ferretdb-migration-validation).
# Off by default so the suite is unchanged for the standard (MongoDB) path; CI sets
# FERRETDB_VALIDATION=1 + FERRETDB_URI->FerretDB to gate the document-store migration validation
# (parity checker + per-tenant data-API smoke + risk-area probes).
if [ "${FERRETDB_VALIDATION:-}" = "1" ]; then
  echo "==> FERRETDB_VALIDATION=1: running FerretDB migration validation" >&2
  bash "$(dirname "$0")/../env/validation/run-ferretdb-validation.sh" || exit 1
fi

if [ -f go.mod ]; then
  exec go test ./tests/blackbox/... ${FILTER:+-run "$FILTER"}
elif [ -f package.json ]; then
  mapfile -d '' BLACKBOX_TESTS < <(find tests/blackbox -type f -name '*.test.mjs' -print0 | sort -z)
  if [ -n "$FILTER" ]; then
    # Avoid importing every test file for a focused run: some black-box files
    # intentionally validate optional external fixtures at module load time.
    # Select files that declare the requested bbx/name pattern, while retaining
    # the previous whole-suite fallback for dynamic test names.
    FILTERED_BLACKBOX_TESTS=()
    for TEST_FILE in "${BLACKBOX_TESTS[@]}"; do
      if grep -Eq -- "$FILTER" "$TEST_FILE"; then
        FILTERED_BLACKBOX_TESTS+=("$TEST_FILE")
      fi
    done
    if [ "${#FILTERED_BLACKBOX_TESTS[@]}" -eq 0 ]; then
      FILTERED_BLACKBOX_TESTS=("${BLACKBOX_TESTS[@]}")
    fi
    exec node --test --test-name-pattern="$FILTER" "${FILTERED_BLACKBOX_TESTS[@]}"
  else
    exec node --test "${BLACKBOX_TESTS[@]}"
  fi
elif command -v pytest >/dev/null 2>&1; then
  exec pytest tests/blackbox ${FILTER:+-k "$FILTER"} -q
elif command -v bats >/dev/null 2>&1; then
  exec bats tests/blackbox
else
  echo "No black-box runner detected. Specialize tests/blackbox/run.sh for your stack." >&2
  exit 2
fi

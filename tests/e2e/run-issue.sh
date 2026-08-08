#!/usr/bin/env bash
# Per-issue E2E: deploy, run ONE issue spec, then ALWAYS tear down exactly what this run owns.
set -euo pipefail
cd "$(dirname "$0")"
ID="${1:?usage: run-issue.sh <change-id>}"
command -v kubectl >/dev/null 2>&1 || { echo "kubectl + a local cluster required." >&2; exit 2; }
command -v npx >/dev/null 2>&1 || { echo "Install Playwright first: npm i -D @playwright/test && npx playwright install --with-deps" >&2; exit 2; }

# Isolate ownership/proof records so concurrent issue runs cannot clean one
# another.  This directory contains resource identities and UIDs, never values.
HARNESS_STATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/falcone-e2e-harness.XXXXXX")"
export E2E_HARNESS_STATE_DIR="$HARNESS_STATE_DIR"

cleanup() {
  local result=$? cleanup_result=0
  trap - EXIT INT TERM
  set +e
  bash stack.sh down
  cleanup_result=$?
  rm -f "$HARNESS_STATE_DIR"/*
  rmdir "$HARNESS_STATE_DIR" 2>/dev/null || true
  if [ "$result" -eq 0 ] && [ "$cleanup_result" -ne 0 ]; then result=$cleanup_result; fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

bash stack.sh up
npx playwright test "specs/issues/${ID}.spec.ts"

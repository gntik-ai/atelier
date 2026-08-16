#!/usr/bin/env bash
set -euo pipefail

D="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$D/.." && pwd)"
TEST_TIMEOUT_SECONDS="${TEST_TIMEOUT_SECONDS:-300}"
LOG_DIR="$(mktemp -d)"
trap 'rm -rf "$LOG_DIR"' EXIT

while IFS= read -r -d '' file; do
  if head -n1 "$file" | grep -qE '^#!.*(bash|sh)'; then
    if ! bash -n "$file"; then
      echo "SHELL_SYNTAX_FAILURE: $file" >&2
      exit 1
    fi
  fi
done < <(find "$ROOT" -path "$ROOT/.git" -prune -o -type f -print0)

python3 "$D/static-validation.py"

run_test() {
  local test="$1"
  local log="$LOG_DIR/$test.log"
  echo "===== $test ====="
  set +e
  timeout --signal=TERM --kill-after=10s "$TEST_TIMEOUT_SECONDS" \
    bash "$D/$test" >"$log" 2>&1
  local status=$?
  set -e
  if [[ $status -ne 0 ]]; then
    echo "FAILED_TEST=$test" >&2
    if [[ $status -eq 124 || $status -eq 137 ]]; then
      echo "FAILURE_REASON=timeout_after_${TEST_TIMEOUT_SECONDS}_seconds" >&2
    else
      echo "FAILURE_REASON=exit_status_$status" >&2
    fi
    echo "----- captured output: $test -----" >&2
    cat "$log" >&2
    echo "----- end captured output -----" >&2
    return "$status"
  fi
  cat "$log"
}

for test in \
  test-installer.sh \
  test-adapter-env-source.sh \
  test-repair-adapter-runtime-command-quoting.sh \
  test-hmw.sh \
  test-artifact-resolvers.sh \
  test-falcone-exact-chart.sh \
  test-falcone-backup-evidence.sh \
  test-falcone-upgrade-gates.sh \
  test-musematic-secret-safe-diff.sh \
  test-musematic-gitops.sh \
  test-argocd-exact-revisions.sh \
  test-llmwiki-openshift.sh \
  test-openshift-expiry.sh \
  test-environment-guards.sh \
  test-update-existing-v4.sh \
  test-repair-v4-side-effects.sh \
  test-browser-scripts-dry-run.sh
  do
    run_test "$test"
  done

echo HERMES_ENGINEERING_PLATFORM_V4_1_3_OFFLINE_TESTS_OK

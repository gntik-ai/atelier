#!/usr/bin/env bash
# Per-issue E2E: deploy to an ephemeral namespace, run ONE issue spec, then ALWAYS tear down.
set -euo pipefail
cd "$(dirname "$0")"
ID="${1:?usage: run-issue.sh <change-id>}"

# Issue-specific, non-secret deployment profiles. Callers still provide external
# prerequisites such as the local kubeconfig, chart reference, image preparation,
# and ephemeral credentials through the documented E2E_* environment variables.
case "$ID" in
  fix-c04-workspace-metric-series)
    export E2E_NAMESPACE="${E2E_NAMESPACE:-falcone-e2e-c04}"
    export E2E_AUX_NAMESPACES="${E2E_AUX_NAMESPACES:-falcone-e2e-c04-secrets}"
    export E2E_HELM_VALUES="${E2E_HELM_VALUES:-tests/e2e/values-c04-workspace-metric-series.yaml}"
    ;;
esac

command -v kubectl >/dev/null 2>&1 || { echo "kubectl + a local cluster required." >&2; exit 2; }
npx playwright --version >/dev/null 2>&1 || { echo "Install Playwright first: npm i -D @playwright/test && npx playwright install --with-deps" >&2; exit 2; }
trap 'bash stack.sh down' EXIT INT TERM      # MANDATORY teardown
bash stack.sh up
npx playwright test "specs/issues/${ID}.spec.ts"

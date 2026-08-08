/**
 * Public black-box safety contract for the issue E2E harness.
 *
 * The harness is launched with process-isolated fake cluster/package clients and
 * KUBECONFIG=/dev/null. No Kubernetes context or credentials are used.
 */
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const repoRoot = resolve(import.meta.dirname, '../..')
const runner = resolve(repoRoot, 'tests/e2e/run-issue.sh')
const stack = resolve(repoRoot, 'tests/e2e/stack.sh')
const changeId = 'issue-933-managed-knative-runtime'
const namespace = 'cingusoft-dev'
const namespaceUid = '00000000-0000-4000-8000-000000000933'
const secretSentinel = 'bbx-933-secret-must-not-leak'

function fakeDispatcher() {
  return `#!/usr/bin/env bash
set -u
command_name="\${0##*/}"
printf '%s\t%s\n' "$command_name" "$*" >>"$BBX_COMMAND_LOG"

case "$command_name" in
  kubectl)
    case " $* " in
      *" config current-context "*) printf '%s\n' 'kind-falcone-bbx'; exit 0 ;;
      *" port-forward "*) trap 'exit 0' TERM INT; while sleep 1; do :; done ;;
    esac
    if [[ " $* " == *" get namespace "* || " $* " == *" get namespaces "* || " $* " == *" get ns "* ]]; then
      [[ "$BBX_SCENARIO" == "missing-namespace" ]] && exit 1
      if [[ "$*" == *"jsonpath"* ]]; then printf '%s' "$BBX_NAMESPACE_UID"; exit 0; fi
      if [[ " $* " == *" -o json "* ]]; then
        printf '{"apiVersion":"v1","kind":"Namespace","metadata":{"name":"%s","uid":"%s"}}\n' "$E2E_NAMESPACE" "$BBX_NAMESPACE_UID"
      else
        printf '%s\n' "$E2E_NAMESPACE"
      fi
      exit 0
    fi
    if [[ " $* " == *" get deployment "* && " $* " == *" -o name "* ]]; then
      if [[ "$BBX_SCENARIO" == "adjacent-unhealthy" && "$*" != *"app.kubernetes.io/instance="* ]]; then printf '%s\n' 'deployment.apps/adjacent-bbx-unhealthy'; fi
      exit 0
    fi
    if [[ " $* " == *" get statefulset "* && " $* " == *" -o name "* ]]; then
      if [[ "$BBX_SCENARIO" == "adjacent-unhealthy" && "$*" != *"app.kubernetes.io/instance="* ]]; then printf '%s\n' 'statefulset.apps/adjacent-bbx-unhealthy'; fi
      exit 0
    fi
    if [[ " $* " == *" get pod "* || " $* " == *" get pods "* ]]; then
      if [[ "$BBX_SCENARIO" == "adjacent-unhealthy" && "$*" != *"app.kubernetes.io/instance="* ]]; then
        if [[ " $* " == *" -o json "* ]]; then
          printf '%s\n' '{"apiVersion":"v1","kind":"List","items":[{"apiVersion":"v1","kind":"Pod","metadata":{"namespace":"cingusoft-dev","name":"adjacent-bbx-unhealthy"},"status":{"phase":"Pending","containerStatuses":[{"name":"adjacent","ready":false}]}}]}'
        else
          printf '%s\n' 'adjacent-bbx-unhealthy 0/1 Pending 0 1m'
        fi
      fi
      exit 0
    fi
    if [[ " $* " == *" get "* ]]; then
      printf '{"apiVersion":"v1","kind":"List","items":[{"apiVersion":"v1","kind":"ConfigMap","metadata":{"namespace":"%s","name":"adjacent-bbx-933","uid":"00000000-0000-4000-8000-000000009933"}}]}\n' "$E2E_NAMESPACE"
    fi
    exit 0
    ;;
  helm)
    if [[ "$1" == "install" && "\${2:-}" == "--help" ]]; then
      printf '%s\n' 'Usage: helm install [NAME] [CHART] [flags]' '      --rollback-on-failure   if set, the installation will be rolled back on failure'
      exit 0
    fi
    if [[ " $* " == *" template "* ]]; then
      if [[ "$BBX_SCENARIO" == "rendered-namespace-conflict" ]]; then
        printf '%s\n' 'apiVersion: v1' 'kind: Namespace' 'metadata:' "  name: $E2E_NAMESPACE" '  labels:' '    unsafe-bbx-change: rejected'
      fi
      exit 0
    fi
    if [[ " $* " == *" list "* ]]; then
      if [[ "$BBX_SCENARIO" == "helm4-list" && " $* " == *" --all "* ]]; then
        printf '%s\n' 'Error: unknown flag: --all' >&2
        exit 2
      fi
      if [[ "$BBX_SCENARIO" == "conflicting-release" ]]; then
        [[ " $* " == *" -o json "* ]] && printf '%s\n' '[{"name":"foreign-release","namespace":"cingusoft-dev","status":"deployed"}]' || printf '%s\n' 'foreign-release'
      elif [[ -s "$BBX_RELEASE_STATE" ]]; then
        release="$(head -n 1 "$BBX_RELEASE_STATE")"
        [[ " $* " == *" -o json "* ]] && printf '[{"name":"%s","namespace":"%s","status":"deployed"}]\n' "$release" "$E2E_NAMESPACE" || printf '%s\n' "$release"
      else
        [[ " $* " == *" -o json "* ]] && printf '%s\n' '[]'
      fi
      exit 0
    fi
    if [[ " $* " == *" status "* ]]; then
      if [[ "$BBX_SCENARIO" == "conflicting-release" || -s "$BBX_RELEASE_STATE" ]]; then printf '%s\n' 'STATUS: deployed'; exit 0; fi
      exit 1
    fi
    if [[ "$1" == "install" && -n "\${2:-}" ]]; then
      printf '%s\n' "$2" >"$BBX_RELEASE_STATE"
      exit 0
    fi
    if [[ " $* " == *" uninstall "* ]]; then
      uninstall_count="$(cat "$BBX_UNINSTALL_COUNT")"
      uninstall_count="$((uninstall_count + 1))"
      printf '%s\n' "$uninstall_count" >"$BBX_UNINSTALL_COUNT"
      if [[ "$BBX_SCENARIO" == "cleanup-failure" && "$uninstall_count" -eq 1 ]]; then
        printf '%s\n' 'injected exact-release uninstall failure' >&2
        exit 73
      fi
      : >"$BBX_RELEASE_STATE"
      exit 0
    fi
    exit 0
    ;;
  kind)
    [[ " $* " == *" get clusters "* ]] && printf '%s\n' 'falcone-bbx'
    exit 0
    ;;
  curl)
    printf '%s\n' '{"status":"ok"}'
    exit 0
    ;;
  npx)
    [[ " $* " == *" playwright --version "* ]] && exit 0
    [[ "$BBX_SCENARIO" == "test-failure" && " $* " == *" playwright test "* ]] && exit 42
    exit 0
    ;;
  npm|pnpm|yarn)
    exit 0
    ;;
  docker|jq)
    exit 0
    ;;
esac
exit 0
`
}

function invokeHarness(scenario, extraEnv = {}) {
  const directory = mkdtempSync(join(tmpdir(), `falcone-e2e-preserve-${scenario}-`))
  const fakeBin = join(directory, 'bin')
  const mkdir = spawnSync('mkdir', ['-p', fakeBin])
  assert.equal(mkdir.status, 0, `fixture mkdir failed: ${mkdir.stderr}`)
  const dispatcher = join(fakeBin, 'bbx-dispatch')
  writeFileSync(dispatcher, fakeDispatcher(), { mode: 0o755 })
  chmodSync(dispatcher, 0o755)
  for (const command of ['kubectl', 'helm', 'kind', 'curl', 'npx', 'npm', 'pnpm', 'yarn', 'docker', 'jq']) {
    symlinkSync('bbx-dispatch', join(fakeBin, command))
  }

  const log = join(directory, 'commands.log')
  const releaseState = join(directory, 'release.state')
  const uninstallCount = join(directory, 'uninstall.count')
  writeFileSync(log, '')
  writeFileSync(releaseState, '')
  writeFileSync(uninstallCount, '0\n')
  const env = {
    ...process.env,
    PATH: `${fakeBin}:/usr/bin:/bin`,
    KUBECONFIG: '/dev/null',
    TMPDIR: directory,
    RUNNER_TEMP: directory,
    E2E_NAMESPACE: namespace,
    E2E_HELM_CHART: 'charts/in-falcone',
    BBX_SCENARIO: scenario,
    BBX_NAMESPACE_UID: namespaceUid,
    BBX_COMMAND_LOG: log,
    BBX_RELEASE_STATE: releaseState,
    BBX_UNINSTALL_COUNT: uninstallCount,
    BBX_SECRET_SENTINEL: secretSentinel,
    ...extraEnv,
  }
  const launch = (file, args, envOverrides = {}) => spawnSync('bash', [file, ...args], {
      cwd: repoRoot,
      env: { ...env, ...envOverrides },
      encoding: 'utf8',
      timeout: 15_000,
      killSignal: 'SIGKILL',
      maxBuffer: 4 * 1024 * 1024,
    })
  const readCalls = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => {
    const [command, ...rest] = line.split('\t')
    return { command, args: rest.join('\t') }
  })
  const result = launch(runner, [changeId])
  const calls = readCalls()
  return {
    result,
    calls,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    retryCleanup: () => {
      const before = readCalls().length
      const retainedStateDirectories = readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('falcone-e2e-harness.'))
        .map((entry) => join(directory, entry.name))
      const retryResult = launch(stack, ['down'], retainedStateDirectories.length === 1
        ? { E2E_HARNESS_STATE_DIR: retainedStateDirectories[0] }
        : {})
      return {
        result: retryResult,
        calls: readCalls().slice(before),
        output: `${retryResult.stdout ?? ''}\n${retryResult.stderr ?? ''}`,
        retainedStateDirectories,
      }
    },
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  }
}

function mutations(invocation) {
  return invocation.calls.filter(({ command, args }) => (
    command === 'helm'
    && /(?:^|\s)(?:upgrade|install|uninstall|delete|rollback)(?:\s|$)/.test(args)
    && !/^install\s+--help(?:\s|$)/.test(args)
  ) || (
    command === 'kubectl' && /(?:^|\s)(?:apply|create|delete|patch|replace|label|annotate|edit|scale|set)(?:\s|$)/.test(args)
  ))
}

function releaseInstalls(invocation) {
  return invocation.calls.filter(({ command, args }) => command === 'helm' && /^install\s+(?!--help(?:\s|$))\S+/.test(args))
}

function namespaceMutations(invocation) {
  return mutations(invocation).filter(({ command, args }) => (
    command === 'kubectl' && /(?:^|\s)(?:namespace|namespaces|ns)(?:\/|\s|$)/.test(args)
  ))
}

function assertRejectedBeforeMutation(invocation, context) {
  assert.notEqual(invocation.result.status, 0, `${context} unexpectedly succeeded`)
  assert.deepEqual(mutations(invocation), [], `${context} reached a cluster or Helm mutation before refusing`)
}

// bbx-933-001 | fn-e2e-preserve-existing-namespace | OpenSpec #### Scenario: Existing namespace E2E execution is explicitly attested and non-destructive
test('issue E2E harness preserves an attested existing namespace without weakening ephemeral cleanup', async (t) => {
  await t.test('ephemeral remains the mutation-capable default', () => {
    const invocation = invokeHarness('ephemeral-default')
    try {
      assert.ok(namespaceMutations(invocation).length > 0, 'unset namespace mode no longer follows the existing ephemeral namespace lifecycle')
    } finally { invocation.cleanup() }
  })

  for (const [name, scenario, env] of [
    ['missing UID attestation', 'missing-attestation', { E2E_NAMESPACE_MODE: 'preserve-existing' }],
    ['mismatched UID attestation', 'mismatched-attestation', { E2E_NAMESPACE_MODE: 'preserve-existing', E2E_EXPECTED_NAMESPACE_UID: '00000000-0000-4000-8000-000000000BAD' }],
    ['missing namespace', 'missing-namespace', { E2E_NAMESPACE_MODE: 'preserve-existing', E2E_EXPECTED_NAMESPACE_UID: namespaceUid }],
    ['conflicting Helm release', 'conflicting-release', { E2E_NAMESPACE_MODE: 'preserve-existing', E2E_EXPECTED_NAMESPACE_UID: namespaceUid }],
    ['rendered Namespace mutation', 'rendered-namespace-conflict', { E2E_NAMESPACE_MODE: 'preserve-existing', E2E_EXPECTED_NAMESPACE_UID: namespaceUid }],
  ]) {
    await t.test(`${name} refuses before mutation`, () => {
      const invocation = invokeHarness(scenario, env)
      try { assertRejectedBeforeMutation(invocation, name) } finally { invocation.cleanup() }
    })
  }

  for (const scenario of ['preserve-success', 'test-failure']) {
    await t.test(`${scenario} cleans only the exact E2E release and leaves adjacent resources`, () => {
      const invocation = invokeHarness(scenario, {
        E2E_NAMESPACE_MODE: 'preserve-existing',
        E2E_EXPECTED_NAMESPACE_UID: namespaceUid,
      })
      try {
        if (scenario === 'preserve-success') assert.equal(invocation.result.status, 0, invocation.output)
        else assert.notEqual(invocation.result.status, 0, 'injected issue-test failure unexpectedly succeeded')
        assert.deepEqual(namespaceMutations(invocation), [], 'preserve-existing mode mutated the Namespace object')

        const helmInstalls = releaseInstalls(invocation)
        const helmUninstalls = invocation.calls.filter(({ command, args }) => command === 'helm' && /(?:^|\s)uninstall\s+\S+/.test(args))
        assert.equal(helmInstalls.length, 1, 'preserve-existing mode must install exactly one E2E release')
        assert.equal(helmUninstalls.length, 1, 'trap cleanup must uninstall the E2E release exactly once')
        const installedRelease = helmInstalls[0].args.match(/^install\s+(\S+)/)?.[1]
        const uninstalledRelease = helmUninstalls[0].args.match(/(?:^|\s)uninstall\s+(\S+)/)?.[1]
        assert.equal(uninstalledRelease, installedRelease, 'cleanup targeted a release other than the one installed by this run')

        for (const { command, args } of mutations(invocation)) {
          if (command === 'kubectl' && /(?:^|\s)delete(?:\s|$)/.test(args)) {
            assert.doesNotMatch(args, /(?:^|\s)(?:--all|-A|--all-namespaces|-l|--selector)(?:=|\s|$)/, 'preserve cleanup used a collection-capable deletion')
          }
        }
        const installIndex = invocation.calls.indexOf(helmInstalls[0])
        const uninstallIndex = invocation.calls.indexOf(helmUninstalls[0])
        const adjacentReads = invocation.calls
          .map((call, index) => ({ ...call, index }))
          .filter(({ command, args }) => command === 'kubectl' && /(?:^|\s)get(?:\s|$)/.test(args) && !/(?:^|\s)(?:namespace|namespaces|ns)(?:\/|\s|$)/.test(args))
        assert.ok(adjacentReads.some(({ index }) => index < installIndex), 'harness omitted adjacent-resource proof before install')
        assert.ok(adjacentReads.some(({ index }) => index > uninstallIndex), 'harness omitted adjacent-resource proof after cleanup')
        assert.doesNotMatch(invocation.output, new RegExp(secretSentinel), 'harness output disclosed secret evidence')
      } finally { invocation.cleanup() }
    })
  }
})

// bbx-933-002 | fn-e2e-preserve-existing-namespace | OpenSpec #### Scenario: Existing namespace E2E execution is explicitly attested and non-destructive
test('issue E2E preserve mode is prerequisite-checked, Helm-4-safe, failure-rollback, release-scoped, and cleanup-retryable', async (t) => {
  const preserveEnv = {
    E2E_NAMESPACE_MODE: 'preserve-existing',
    E2E_EXPECTED_NAMESPACE_UID: namespaceUid,
  }

  await t.test('executes the Playwright prerequisite before the first write', () => {
    const invocation = invokeHarness('prerequisite-probe', preserveEnv)
    try {
      assert.equal(invocation.result.status, 0, invocation.output)
      const prerequisiteIndex = invocation.calls.findIndex(({ command, args }) => command === 'npx' && /^playwright --version(?:\s|$)/.test(args))
      const firstMutationIndex = invocation.calls.findIndex((call) => mutations({ calls: [call] }).length > 0)
      assert.ok(prerequisiteIndex >= 0, 'harness checked only for an npx executable instead of executing npx playwright --version')
      assert.ok(firstMutationIndex < 0 || prerequisiteIndex < firstMutationIndex, 'Playwright prerequisite ran after the first cluster write')
    } finally { invocation.cleanup() }
  })

  await t.test('uses a Helm 4-compatible release collision probe', () => {
    const invocation = invokeHarness('helm4-list', preserveEnv)
    try {
      assert.equal(invocation.result.status, 0, invocation.output)
      const releaseReads = invocation.calls.filter(({ command, args }) => command === 'helm' && /^list(?:\s|$)/.test(args))
      assert.ok(releaseReads.length > 0, 'preserve mode omitted its fail-closed Helm release collision probe')
      for (const { args } of releaseReads) {
        assert.doesNotMatch(args, /(?:^|\s)--all(?:\s|$)/, 'release collision probe uses Helm-3-only helm list --all')
      }
    } finally { invocation.cleanup() }
  })

  await t.test('installs the exact release with the Helm 4 failure rollback capability', () => {
    const invocation = invokeHarness('rollback-install', preserveEnv)
    try {
      assert.equal(invocation.result.status, 0, invocation.output)
      const installs = releaseInstalls(invocation)
      assert.equal(installs.length, 1, 'preserve mode must perform one exact Helm install')
      assert.match(installs[0].args, /(?:^|\s)--rollback-on-failure(?:\s|$)/, 'Helm 4 preserve install omitted --rollback-on-failure')
      const helpIndex = invocation.calls.findIndex(({ command, args }) => command === 'helm' && /^install\s+--help(?:\s|$)/.test(args))
      const installIndex = invocation.calls.indexOf(installs[0])
      assert.ok(helpIndex >= 0, 'harness did not probe helm install --help for the supported failure rollback flag')
      assert.ok(helpIndex < installIndex, 'Helm failure rollback capability was probed after installation')
    } finally { invocation.cleanup() }
  })

  await t.test('health checks only the installed release and ignores an unhealthy adjacent workload', () => {
    const invocation = invokeHarness('adjacent-unhealthy', preserveEnv)
    try {
      assert.equal(invocation.result.status, 0, invocation.output)
      assert.doesNotMatch(invocation.output, /adjacent-bbx-unhealthy/, 'harness inspected or reported an adjacent workload as part of release health')
      const healthReads = invocation.calls.filter(({ command, args }) => (
        command === 'kubectl'
        && /(?:^|\s)get\s+(?:deployment|statefulset|pod|pods)(?:\s|$)/.test(args)
      ))
      assert.ok(healthReads.length > 0, 'harness omitted its release health probe')
      for (const { args } of healthReads) {
        assert.match(args, /(?:^|\s)(?:-l|--selector)(?:=|\s+)app\.kubernetes\.io\/instance=/, 'preserve-mode health read was not scoped to the installed Helm release')
      }
    } finally { invocation.cleanup() }
  })

  await t.test('failed exact-release cleanup retains enough state for an idempotent retry', () => {
    const invocation = invokeHarness('cleanup-failure', preserveEnv)
    try {
      assert.notEqual(invocation.result.status, 0, 'injected Helm uninstall failure was hidden from the caller')
      const firstUninstalls = invocation.calls.filter(({ command, args }) => command === 'helm' && /(?:^|\s)uninstall\s+\S+/.test(args))
      assert.equal(firstUninstalls.length, 1, 'initial cleanup did not attempt the exact release once')
      const release = firstUninstalls[0].args.match(/(?:^|\s)uninstall\s+(\S+)/)?.[1]

      const retry = invocation.retryCleanup()
      assert.equal(retry.retainedStateDirectories.length, 1, 'failed cleanup deleted its private ownership/evidence directory instead of retaining it for retry')
      assert.equal(retry.result.status, 0, retry.output)
      const retryUninstalls = retry.calls.filter(({ command, args }) => command === 'helm' && /(?:^|\s)uninstall\s+\S+/.test(args))
      assert.equal(retryUninstalls.length, 1, 'failed cleanup discarded its ownership state instead of allowing one exact retry')
      assert.equal(retryUninstalls[0].args.match(/(?:^|\s)uninstall\s+(\S+)/)?.[1], release, 'cleanup retry targeted a different Helm release')
      assert.deepEqual(namespaceMutations({ calls: retry.calls }), [], 'cleanup retry mutated the preserved Namespace')
    } finally { invocation.cleanup() }
  })
})

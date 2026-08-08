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
const ownedResourceName = 'bbx-release-owned'

function fakeDispatcher() {
  return `#!/usr/bin/env bash
set -u
command_name="\${0##*/}"
printf '%s\t%s\n' "$command_name" "$*" >>"$BBX_COMMAND_LOG"

case "$command_name" in
  kubectl)
    kubectl_args_lower="\${*,,}"
    case " $* " in
      *" config current-context "*) printf '%s\n' 'kind-falcone-bbx'; exit 0 ;;
      *" port-forward "*) trap 'exit 0' TERM INT; while sleep 1; do :; done ;;
    esac
    if [[ " $* " == *" get --raw "* ]]; then
      discovery_path="\${*: -1}"
      case "$discovery_path" in
        /api)
          printf '%s\n' '{"kind":"APIVersions","versions":["v1"]}'
          ;;
        /apis)
          printf '%s\n' '{"kind":"APIGroupList","groups":[{"name":"apps","versions":[{"groupVersion":"apps/v1","version":"v1"}]},{"name":"batch","versions":[{"groupVersion":"batch/v1","version":"v1"}]},{"name":"example.io","versions":[{"groupVersion":"example.io/v1","version":"v1"}]},{"name":"certificates.k8s.io","versions":[{"groupVersion":"certificates.k8s.io/v1","version":"v1"}]}]}'
          ;;
        /api/v1)
          if [[ "$BBX_SCENARIO" == "hook-pod" ]]; then
            printf '%s\n' '{"kind":"APIResourceList","groupVersion":"v1","resources":[{"name":"pods","namespaced":true,"kind":"Pod","verbs":["get","list"]}]}'
          else
            printf '%s\n' '{"kind":"APIResourceList","groupVersion":"v1","resources":[{"name":"configmaps","namespaced":true,"kind":"ConfigMap","verbs":["get","list"]}]}'
          fi
          ;;
        /apis/apps/v1)
          printf '%s\n' '{"kind":"APIResourceList","groupVersion":"apps/v1","resources":[{"name":"deployments","namespaced":true,"kind":"Deployment","verbs":["get","list"]}]}'
          ;;
        /apis/batch/v1)
          printf '%s\n' '{"kind":"APIResourceList","groupVersion":"batch/v1","resources":[{"name":"jobs","namespaced":true,"kind":"Job","verbs":["get","list"]}]}'
          ;;
        /apis/example.io/v1)
          if [[ "$BBX_SCENARIO" == "rendered-cluster-cr" ]]; then
            printf '%s\n' '{"kind":"APIResourceList","groupVersion":"example.io/v1","resources":[{"name":"clusterwidgets","namespaced":false,"kind":"ClusterWidget","verbs":["get","list"]}]}'
          else
            printf '%s\n' '{"kind":"APIResourceList","groupVersion":"example.io/v1","resources":[{"name":"widgets","namespaced":true,"kind":"Widget","verbs":["get","list"]}]}'
          fi
          ;;
        /apis/certificates.k8s.io/v1)
          printf '%s\n' '{"kind":"APIResourceList","groupVersion":"certificates.k8s.io/v1","resources":[{"name":"certificatesigningrequests","namespaced":false,"kind":"CertificateSigningRequest","verbs":["get","list"]}]}'
          ;;
        *) exit 1 ;;
      esac
      exit 0
    fi
    if [[ " $* " == *" api-resources "* ]]; then
      # The preserve preflight must discover the scope of every rendered GVK. Keep the
      # existing adjacent-resource snapshot response distinct from GVK-specific discovery.
      if [[ " $* " == *" --verbs=list "* && " $* " == *" --namespaced=true "* && " $* " == *" -o name "* ]]; then
        printf '%s\n' 'configmaps' 'deployments.apps'
        [[ "$BBX_SCENARIO" == "discovery-resolves-gvks" ]] && printf '%s\n' 'widgets.example.io'
        exit 0
      fi
      case "$BBX_SCENARIO" in
        discovery-resolves-gvks)
          if [[ " $* " == *" -o name "* ]]; then
            printf '%s\n' 'configmaps' 'deployments.apps' 'widgets.example.io'
          else
            printf '%s\n' \
              'configmaps cm v1 true ConfigMap get,list' \
              'deployments deploy apps/v1 true Deployment get,list' \
              'widgets wd example.io/v1 true Widget get,list'
          fi
          ;;
        discovery-empty-shortnames)
          if [[ " $* " == *" -o name "* ]]; then
            printf '%s\n' 'configmaps' 'deployments.apps'
          else
            # Real kubectl api-resources -o wide: SHORTNAMES may be empty, so whitespace
            # parsing must not shift APIVERSION/NAMESPACED/KIND. The same Kind in another
            # apiVersion proves discovery must match the full apiVersion+kind tuple.
            printf '%s\n' \
              'configmaps                       v1 true ConfigMap get,list' \
              'configmaps foreign example.io/v1 false ConfigMap get,list' \
              'deployments                      apps/v1 true Deployment get,list'
          fi
          ;;
        rendered-cluster-cr)
          [[ " $* " == *" -o name "* ]] && printf '%s\n' 'clusterwidgets.example.io' || printf '%s\n' 'clusterwidgets cw example.io/v1 false ClusterWidget get,list'
          ;;
        rendered-csr)
          [[ " $* " == *" -o name "* ]] && printf '%s\n' 'certificatesigningrequests.certificates.k8s.io' || printf '%s\n' 'certificatesigningrequests csr certificates.k8s.io/v1 false CertificateSigningRequest get,list'
          ;;
        rendered-unknown-gvk)
          # Discovery cannot resolve this rendered GVK at all: fail-closed is required.
          ;;
        hook-job)
          [[ " $* " == *" -o name "* ]] && printf '%s\n' 'jobs.batch' || printf '%s\n' 'jobs job batch/v1 true Job get,list'
          ;;
        hook-pod)
          [[ " $* " == *" -o name "* ]] && printf '%s\n' 'pods' || printf '%s\n' 'pods po v1 true Pod get,list'
          ;;
        *)
          if [[ " $* " == *" -o name "* ]]; then
            printf '%s\n' 'configmaps' 'deployments.apps'
          else
            printf '%s\n' 'configmaps cm v1 true ConfigMap get,list' 'deployments deploy apps/v1 true Deployment get,list'
          fi
          ;;
      esac
      exit 0
    fi
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
    if [[ "$kubectl_args_lower" == *"bbx-release-owned"* && (" $kubectl_args_lower " == *" get configmap "* || " $kubectl_args_lower " == *" get configmaps "* || " $kubectl_args_lower " == *" get configmap/"*) ]]; then
      if [[ "$(cat "$BBX_OWNED_RESOURCE_STATE")" != "present" ]]; then
        [[ " $* " == *" --ignore-not-found "* ]] && exit 0
        exit 1
      fi
      if [[ "$*" == *"jsonpath"* ]]; then printf '%s' '00000000-0000-4000-8000-000000001933'; exit 0; fi
      if [[ " $* " == *" -o name "* ]]; then printf '%s\n' 'configmap/bbx-release-owned'; exit 0; fi
      if [[ " $* " == *" -o json "* ]]; then
        printf '%s\n' '{"apiVersion":"v1","kind":"ConfigMap","metadata":{"namespace":"cingusoft-dev","name":"bbx-release-owned","uid":"00000000-0000-4000-8000-000000001933","labels":{"app.kubernetes.io/instance":"falcone"}}}'
      else
        printf '%s\n' 'bbx-release-owned'
      fi
      exit 0
    fi
    if [[ "$kubectl_args_lower" == *"sh.helm.release.v1.falcone.v1"* && " $kubectl_args_lower " == *" get "* ]]; then
      [[ -s "$BBX_RELEASE_STATE" ]] || exit 0
      if [[ "$*" == *"jsonpath"* ]]; then printf '%s' '00000000-0000-4000-8000-000000002933'; exit 0; fi
      exit 0
    fi
    if [[ "$BBX_SCENARIO" == "discovery-resolves-gvks" && "$kubectl_args_lower" == *"bbx-namespaced-cr"* && " $kubectl_args_lower " == *" get "* ]]; then
      [[ -s "$BBX_RELEASE_STATE" ]] || exit 0
      if [[ "$*" == *"jsonpath"* ]]; then printf '%s' '00000000-0000-4000-8000-000000003933'; fi
      exit 0
    fi
    if [[ "$kubectl_args_lower" == *"bbx-release-workload"* && " $kubectl_args_lower " == *" get "* ]]; then
      [[ -s "$BBX_RELEASE_STATE" ]] || exit 0
      if [[ "$*" == *"jsonpath"* ]]; then printf '%s' '00000000-0000-4000-8000-000000004933'; fi
      exit 0
    fi
    if [[ "$BBX_SCENARIO" =~ ^(rendered-unknown-gvk|rendered-cluster-cr|rendered-csr|hook-job|hook-pod)$ && "$*" == *"jsonpath"* ]]; then
      # The current static-kind preflight sees a free namespaced name and proceeds. A
      # discovery-driven implementation must reject the unresolved/cluster/hook object first.
      exit 0
    fi
    if [[ "$*" == *"bbx-release-owned"* && " $* " == *" wait "* && "$*" == *"--for=delete"* ]]; then
      [[ "$(cat "$BBX_OWNED_RESOURCE_STATE")" == "absent" ]]
      exit $?
    fi
    if [[ " $* " == *" get deployment "* && " $* " == *" -o name "* ]]; then
      if [[ "$*" == *"app.kubernetes.io/instance=falcone"* && -s "$BBX_RELEASE_STATE"
        && "$BBX_SCENARIO" != "empty-health-selector" && "$BBX_SCENARIO" != "helm-status-transport-error" ]]; then
        printf '%s\n' 'deployment.apps/bbx-release-workload'
      elif [[ "$BBX_SCENARIO" == "adjacent-unhealthy" && "$*" != *"app.kubernetes.io/instance="* ]]; then
        printf '%s\n' 'deployment.apps/adjacent-bbx-unhealthy'
      fi
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
      if [[ "$(cat "$BBX_ADJACENT_RESOURCE_STATE")" == "present" ]]; then
        printf '{"apiVersion":"v1","kind":"List","items":[{"apiVersion":"v1","kind":"ConfigMap","metadata":{"namespace":"%s","name":"adjacent-bbx-933","uid":"00000000-0000-4000-8000-000000009933"}}]}\n' "$E2E_NAMESPACE"
      else
        printf '%s\n' '{"apiVersion":"v1","kind":"List","items":[]}'
      fi
    fi
    exit 0
    ;;
  helm)
    if [[ "$1" == "install" && "\${2:-}" == "--help" ]]; then
      printf '%s\n' 'Usage: helm install [NAME] [CHART] [flags]' '      --rollback-on-failure   if set, the installation will be rolled back on failure'
      exit 0
    fi
    if [[ " $* " == *" template "* ]]; then
      case "$BBX_SCENARIO" in
        rendered-namespace-conflict)
          printf '%s\n' 'apiVersion: v1' 'kind: Namespace' 'metadata:' "  name: $E2E_NAMESPACE" '  labels:' '    unsafe-bbx-change: rejected'
          ;;
        discovery-resolves-gvks)
          printf '%s\n' \
            'apiVersion: v1' 'kind: ConfigMap' 'metadata:' "  namespace: $E2E_NAMESPACE" '  name: bbx-release-owned' '---' \
            'apiVersion: example.io/v1' 'kind: Widget' 'metadata:' "  namespace: $E2E_NAMESPACE" '  name: bbx-namespaced-cr' '---' \
            'apiVersion: apps/v1' 'kind: Deployment' 'metadata:' "  namespace: $E2E_NAMESPACE" '  name: bbx-release-workload' '  labels:' '    app.kubernetes.io/instance: falcone' 'spec:' '  replicas: 1'
          ;;
        rendered-unknown-gvk)
          printf '%s\n' 'apiVersion: mystery.example.io/v1' 'kind: VanishingClusterThing' 'metadata:' '  name: bbx-unknown-cluster-object'
          ;;
        rendered-cluster-cr)
          printf '%s\n' 'apiVersion: example.io/v1' 'kind: ClusterWidget' 'metadata:' '  name: bbx-cluster-cr'
          ;;
        rendered-csr)
          printf '%s\n' 'apiVersion: certificates.k8s.io/v1' 'kind: CertificateSigningRequest' 'metadata:' '  name: bbx-csr'
          ;;
        hook-job)
          printf '%s\n' 'apiVersion: batch/v1' 'kind: Job' 'metadata:' "  namespace: $E2E_NAMESPACE" '  name: bbx-benign-hook-job' '  annotations:' '    helm.sh/hook: pre-install' 'spec:' '  template:' '    spec:' '      restartPolicy: Never' '      containers:' '        - name: harmless' '          image: busybox:1.36' '          command: ["sh", "-c", "echo harmless"]'
          ;;
        hook-pod)
          printf '%s\n' 'apiVersion: v1' 'kind: Pod' 'metadata:' "  namespace: $E2E_NAMESPACE" '  name: bbx-benign-hook-pod' '  annotations:' '    helm.sh/hook: test' 'spec:' '  restartPolicy: Never' '  containers:' '    - name: harmless' '      image: busybox:1.36' '      command: ["sleep", "1"]'
          ;;
        helm-status-transport-error)
          printf '%s\n' '# deliberately empty release: helm status remains the ownership authority'
          ;;
        empty-health-selector)
          printf '%s\n' 'apiVersion: v1' 'kind: ConfigMap' 'metadata:' "  namespace: $E2E_NAMESPACE" '  name: bbx-release-owned' '  labels:' '    app.kubernetes.io/instance: falcone' 'data:' '  contract: intentionally-no-workload'
          ;;
        *)
          printf '%s\n' \
            'apiVersion: v1' 'kind: ConfigMap' 'metadata:' "  namespace: $E2E_NAMESPACE" '  name: bbx-release-owned' '  labels:' '    app.kubernetes.io/instance: falcone' 'data:' '  contract: owned' '---' \
            'apiVersion: apps/v1' 'kind: Deployment' 'metadata:' "  namespace: $E2E_NAMESPACE" '  name: bbx-release-workload' '  labels:' '    app.kubernetes.io/instance: falcone' 'spec:' '  replicas: 1'
          ;;
      esac
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
      if [[ "$BBX_SCENARIO" == "helm-status-transport-error" ]]; then
        printf '%s\n' 'Error: Kubernetes cluster unreachable: injected TLS transport failure' >&2
        exit 75
      fi
      if [[ "$BBX_SCENARIO" == "helm-status-ambiguous-404" ]]; then
        printf '%s\n' 'Error: Kubernetes API transport failed: upstream discovery endpoint returned 404 Not Found' >&2
        exit 75
      fi
      if [[ "$BBX_SCENARIO" == "conflicting-release" || -s "$BBX_RELEASE_STATE" ]]; then printf '%s\n' 'STATUS: deployed'; exit 0; fi
      exit 1
    fi
    if [[ "$1" == "install" && -n "\${2:-}" ]]; then
      printf '%s\n' "$2" >"$BBX_RELEASE_STATE"
      printf '%s\n' 'present' >"$BBX_OWNED_RESOURCE_STATE"
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
      if [[ "$BBX_SCENARIO" != "orphaned-owned-resource" ]]; then printf '%s\n' 'absent' >"$BBX_OWNED_RESOURCE_STATE"; fi
      if [[ "$BBX_SCENARIO" == "adjacent-disappears-after-uninstall" ]]; then printf '%s\n' 'absent' >"$BBX_ADJACENT_RESOURCE_STATE"; fi
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
  const ownedResourceState = join(directory, 'owned-resource.state')
  const adjacentResourceState = join(directory, 'adjacent-resource.state')
  writeFileSync(log, '')
  writeFileSync(releaseState, '')
  writeFileSync(uninstallCount, '0\n')
  writeFileSync(ownedResourceState, 'absent\n')
  writeFileSync(adjacentResourceState, 'present\n')
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
    BBX_OWNED_RESOURCE_STATE: ownedResourceState,
    BBX_ADJACENT_RESOURCE_STATE: adjacentResourceState,
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
    ownedResourcePresent: () => readFileSync(ownedResourceState, 'utf8').trim() === 'present',
    retainedStateDirectories: () => readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('falcone-e2e-harness.'))
      .map((entry) => join(directory, entry.name)),
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
        retainedStateDirectoriesAfter: readdirSync(directory, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && entry.name.startsWith('falcone-e2e-harness.'))
          .map((entry) => join(directory, entry.name)),
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

function isDiscoveryCall({ command, args }) {
  return command === 'kubectl' && (
    /(?:^|\s)api-resources(?:\s|$)/.test(args)
    || /(?:^|\s)get\s+--raw\s+\/apis?(?:\/|\s|$)/.test(args)
  )
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

// bbx-933-003 | fn-e2e-preserve-existing-namespace | OpenSpec #### Scenario: Existing namespace E2E execution is explicitly attested and non-destructive
test('preserve cleanup proves every UID-attested release object is absent after Helm uninstall', async (t) => {
  const preserveEnv = {
    E2E_NAMESPACE_MODE: 'preserve-existing',
    E2E_EXPECTED_NAMESPACE_UID: namespaceUid,
  }
  const ownedCalls = (invocation) => invocation.calls
    .map((call, index) => ({ ...call, index }))
    .filter(({ command, args }) => command === 'kubectl' && args.includes(ownedResourceName))

  await t.test('normal cleanup observes the owned object before uninstall and proves its absence afterward', () => {
    const invocation = invokeHarness('post-uninstall-absence', preserveEnv)
    try {
      assert.equal(invocation.result.status, 0, invocation.output)
      const installs = releaseInstalls(invocation)
      const uninstalls = invocation.calls.filter(({ command, args }) => command === 'helm' && /(?:^|\s)uninstall\s+\S+/.test(args))
      assert.equal(installs.length, 1, 'fixture did not install the release-owned object exactly once')
      assert.equal(uninstalls.length, 1, 'normal cleanup did not uninstall the exact release once')
      const installIndex = invocation.calls.indexOf(installs[0])
      const uninstallIndex = invocation.calls.indexOf(uninstalls[0])
      const observations = ownedCalls(invocation)
      assert.ok(
        observations.some(({ index, args }) => index > installIndex && index < uninstallIndex && /(?:^|\s)get(?:\s|$)/.test(args)),
        `cleanup never UID-attested ${ownedResourceName} before uninstall`,
      )
      assert.ok(
        observations.some(({ index, args }) => index > uninstallIndex && (/(?:^|\s)get(?:\s|$)/.test(args) || /(?:^|\s)wait(?:\s|$)/.test(args))),
        `cleanup never proved ${ownedResourceName} absent after uninstall`,
      )
      assert.equal(invocation.ownedResourcePresent(), false, `${ownedResourceName} remained after normal cleanup`)
    } finally { invocation.cleanup() }
  })

  await t.test('successful Helm response with an owned orphan fails closed and retains cleanup evidence', () => {
    const invocation = invokeHarness('orphaned-owned-resource', preserveEnv)
    try {
      assert.notEqual(invocation.result.status, 0, 'cleanup accepted Helm success while a UID-attested owned object remained')
      const uninstalls = invocation.calls.filter(({ command, args }) => command === 'helm' && /(?:^|\s)uninstall\s+\S+/.test(args))
      assert.equal(uninstalls.length, 1, 'orphan scenario did not receive exactly one successful exact-release uninstall')
      const uninstallIndex = invocation.calls.indexOf(uninstalls[0])
      assert.ok(
        ownedCalls(invocation).some(({ index, args }) => index > uninstallIndex && (/(?:^|\s)get(?:\s|$)/.test(args) || /(?:^|\s)wait(?:\s|$)/.test(args))),
        'cleanup did not check the UID-attested owned object after Helm reported success',
      )
      assert.equal(invocation.ownedResourcePresent(), true, 'orphan fixture did not retain its release-owned object')
      assert.equal(invocation.retainedStateDirectories().length, 1, 'orphaned cleanup deleted ownership/evidence needed for a safe retry')
      assert.doesNotMatch(invocation.output, new RegExp(secretSentinel), 'orphan evidence disclosed secret output')
      assert.match(invocation.output, /orphan|remain|cleanup|owned|absent|refus/i, 'orphan failure did not provide actionable secret-safe evidence')
    } finally { invocation.cleanup() }
  })
})

// bbx-933-004 | fn-e2e-preserve-existing-namespace | OpenSpec #### Scenario: Existing namespace E2E execution is explicitly attested and non-destructive
test('an unresolved adjacent-resource UID proof remains fail-closed and retryable after uninstall', () => {
  const invocation = invokeHarness('adjacent-disappears-after-uninstall', {
    E2E_NAMESPACE_MODE: 'preserve-existing',
    E2E_EXPECTED_NAMESPACE_UID: namespaceUid,
  })
  try {
    assert.notEqual(invocation.result.status, 0, 'cleanup accepted the disappearance of a preexisting adjacent-resource UID')
    const uninstalls = invocation.calls.filter(({ command, args }) => command === 'helm' && /(?:^|\s)uninstall\s+\S+/.test(args))
    assert.equal(uninstalls.length, 1, 'initial cleanup did not uninstall the exact E2E release once')
    assert.deepEqual(namespaceMutations(invocation), [], 'initial adjacent-UID proof failure mutated the preserved Namespace')
    const retainedBeforeRetry = invocation.retainedStateDirectories()
    assert.equal(retainedBeforeRetry.length, 1, 'initial adjacent-UID proof failure did not retain its ownership/evidence directory')
    assert.match(invocation.output, /adjacent|identity|uid|snapshot|proof|changed|disappear/i, 'initial failure omitted actionable adjacent-resource evidence')

    const retry = invocation.retryCleanup()
    assert.deepEqual(
      {
        failedClosed: retry.result.status !== 0,
        retainedCount: retry.retainedStateDirectoriesAfter.length,
        retainedSameDirectory: retry.retainedStateDirectoriesAfter[0] === retainedBeforeRetry[0],
      },
      {
        failedClosed: true,
        retainedCount: 1,
        retainedSameDirectory: true,
      },
      'cleanup retry falsely succeeded or deleted unresolved adjacent-resource evidence after the active marker was removed',
    )
    assert.deepEqual(namespaceMutations({ calls: retry.calls }), [], 'adjacent-UID cleanup retry mutated the preserved Namespace')
    assert.equal(
      retry.calls.filter(({ command, args }) => command === 'helm' && /(?:^|\s)uninstall\s+\S+/.test(args)).length,
      0,
      'adjacent-UID proof retry uninstalled an already-removed release again',
    )
    assert.doesNotMatch(`${invocation.output}\n${retry.output}`, new RegExp(secretSentinel), 'adjacent-UID retry evidence disclosed secret output')
  } finally { invocation.cleanup() }
})

// bbx-933-005 | fn-e2e-preserve-existing-namespace | OpenSpec #### Scenario: Existing namespace E2E execution is explicitly attested and non-destructive
test('preserve preflight resolves every rendered GVK through discovery and rejects unresolved or cluster-scoped objects', async (t) => {
  const preserveEnv = {
    E2E_NAMESPACE_MODE: 'preserve-existing',
    E2E_EXPECTED_NAMESPACE_UID: namespaceUid,
  }

  await t.test('discovers rendered core and custom-resource GVKs before checking their object names', () => {
    const invocation = invokeHarness('discovery-resolves-gvks', preserveEnv)
    try {
      assert.equal(invocation.result.status, 0, invocation.output)
      const templateIndex = invocation.calls.findIndex(({ command, args }) => command === 'helm' && /(?:^|\s)template(?:\s|$)/.test(args))
      const discoveryIndexes = invocation.calls
        .map((call, index) => ({ ...call, index }))
        .filter(isDiscoveryCall)
        .map(({ index }) => index)
      const preflightObjectReads = invocation.calls
        .map((call, index) => ({ ...call, index }))
        .filter(({ command, args }) => command === 'kubectl'
          && /(?:^|\s)get(?:\s|$)/.test(args)
          && /bbx-release-owned|bbx-namespaced-cr/.test(args))
      assert.ok(templateIndex >= 0, 'fixture did not render the Helm chart')
      assert.equal(preflightObjectReads.length >= 2, true, 'fixture did not exercise both rendered GVKs')
      assert.ok(
        discoveryIndexes.some((index) => index > templateIndex && index < Math.min(...preflightObjectReads.map(({ index: readIndex }) => readIndex))),
        'rendered object names were queried before API discovery resolved their GVK scope',
      )
    } finally { invocation.cleanup() }
  })

  await t.test('accepts empty SHORTNAMES only after exact apiVersion+kind+namespaced discovery', () => {
    const invocation = invokeHarness('discovery-empty-shortnames', preserveEnv)
    try {
      assert.equal(invocation.result.status, 0, invocation.output)
      const templateIndex = invocation.calls.findIndex(({ command, args }) => command === 'helm' && /(?:^|\s)template(?:\s|$)/.test(args))
      const firstRenderedRead = invocation.calls.findIndex(({ command, args }) => command === 'kubectl'
        && /(?:^|\s)get(?:\s|$)/.test(args)
        && /bbx-release-owned|bbx-release-workload/.test(args))
      const discoveryIndex = invocation.calls.findIndex((call, index) => index > templateIndex && isDiscoveryCall(call))
      assert.ok(discoveryIndex > templateIndex && discoveryIndex < firstRenderedRead, 'exact rendered GVK discovery did not precede object-name checks')
      assert.equal(releaseInstalls(invocation).length, 1, 'valid namespaced GVKs with empty SHORTNAMES were rejected')
    } finally { invocation.cleanup() }
  })

  for (const [label, scenario] of [
    ['unresolved GVK', 'rendered-unknown-gvk'],
    ['cluster-scoped custom resource', 'rendered-cluster-cr'],
    ['CertificateSigningRequest', 'rendered-csr'],
  ]) {
    await t.test(`${label} is rejected before Helm install`, () => {
      const invocation = invokeHarness(scenario, preserveEnv)
      try {
        assertRejectedBeforeMutation(invocation, label)
        assert.ok(
          invocation.calls.some(isDiscoveryCall),
          `${label} was rejected without a discovery attempt`,
        )
        assert.match(invocation.output, /discover|scope|cluster|GVK|resource|refus|resolve/i, `${label} rejection omitted actionable discovery evidence`)
      } finally { invocation.cleanup() }
    })
  }
})

// bbx-933-006 | fn-e2e-preserve-existing-namespace | OpenSpec #### Scenario: Existing namespace E2E execution is explicitly attested and non-destructive
test('preserve preflight rejects every workload hook independently of command or image heuristics', async (t) => {
  const preserveEnv = {
    E2E_NAMESPACE_MODE: 'preserve-existing',
    E2E_EXPECTED_NAMESPACE_UID: namespaceUid,
  }
  for (const [label, scenario] of [['pre-install Job', 'hook-job'], ['test Pod', 'hook-pod']]) {
    await t.test(`${label} is rejected before Helm install`, () => {
      const invocation = invokeHarness(scenario, preserveEnv)
      try {
        assertRejectedBeforeMutation(invocation, label)
        assert.match(invocation.output, /hook|workload|job|pod|refus|reject/i, `${label} rejection omitted actionable hook evidence`)
      } finally { invocation.cleanup() }
    })
  }
})

// bbx-933-007 | fn-e2e-preserve-existing-namespace | OpenSpec #### Scenario: Existing namespace E2E execution is explicitly attested and non-destructive
test('a Helm status transport/auth/server error never means release absent and keeps retryable evidence', () => {
  const invocation = invokeHarness('helm-status-transport-error', {
    E2E_NAMESPACE_MODE: 'preserve-existing',
    E2E_EXPECTED_NAMESPACE_UID: namespaceUid,
  })
  try {
    const statusReads = invocation.calls.filter(({ command, args }) => command === 'helm' && /(?:^|\s)status\s+falcone(?:\s|$)/.test(args))
    const retained = invocation.retainedStateDirectories()
    let retry = null
    if (retained.length === 1) retry = invocation.retryCleanup()
    assert.deepEqual({
      failedClosed: invocation.result.status !== 0,
      statusRead: statusReads.length > 0,
      uninstallCount: invocation.calls.filter(({ command, args }) => command === 'helm' && /(?:^|\s)uninstall\s+falcone(?:\s|$)/.test(args)).length,
      retainedCount: retained.length,
      retryFailedClosed: retry ? retry.result.status !== 0 : false,
      retainedAfterRetry: retry ? retry.retainedStateDirectoriesAfter.length : 0,
    }, {
      failedClosed: true,
      statusRead: true,
      uninstallCount: 0,
      retainedCount: 1,
      retryFailedClosed: true,
      retainedAfterRetry: 1,
    }, 'ambiguous Helm status was treated as release absence or its ownership evidence was discarded')
    assert.match(`${invocation.output}\n${retry?.output ?? ''}`, /status|transport|auth|server|uncertain|retry|evidence/i, 'status failure omitted actionable secret-safe retry evidence')
  } finally { invocation.cleanup() }
})

// bbx-933-009 | fn-e2e-preserve-existing-namespace | OpenSpec #### Scenario: Existing namespace E2E execution is explicitly attested and non-destructive
test('an ambiguous Kubernetes API 404 from Helm status is not authoritative release absence', () => {
  const invocation = invokeHarness('helm-status-ambiguous-404', {
    E2E_NAMESPACE_MODE: 'preserve-existing',
    E2E_EXPECTED_NAMESPACE_UID: namespaceUid,
  })
  try {
    const retained = invocation.retainedStateDirectories()
    const retry = retained.length === 1 ? invocation.retryCleanup() : null
    const releaseStorageReadsAfterStatus = (calls) => {
      const statusIndex = calls.findIndex(({ command, args }) => command === 'helm'
        && /(?:^|\s)status\s+falcone(?:\s|$)/.test(args))
      return calls.filter(({ command, args }, index) => index > statusIndex
        && command === 'kubectl'
        && /(?:^|\s)get\s+(?:secret|configmap)(?:\s|$)/.test(args)
        && /sh\.helm\.release\.v1\.falcone\.v1/.test(args)
        && /jsonpath/.test(args))
    }
    const initialUninstalls = invocation.calls.filter(({ command, args }) => command === 'helm'
      && /(?:^|\s)uninstall\s+falcone(?:\s|$)/.test(args))
    const retryUninstalls = retry?.calls.filter(({ command, args }) => command === 'helm'
      && /(?:^|\s)uninstall\s+falcone(?:\s|$)/.test(args)) ?? []

    assert.deepEqual({
      failedClosed: invocation.result.status !== 0,
      retainedCount: retained.length,
      releaseStorageProofAfterAmbiguousStatus: releaseStorageReadsAfterStatus(invocation.calls).length > 0,
      uninstallCount: initialUninstalls.length,
      retryFailedClosed: retry ? retry.result.status !== 0 : false,
      sameEvidenceRetainedForRetry: retry
        ? JSON.stringify(retry.retainedStateDirectoriesAfter) === JSON.stringify(retained)
        : false,
      retryReleaseStorageProofAfterAmbiguousStatus: retry
        ? releaseStorageReadsAfterStatus(retry.calls).length > 0
        : false,
      retryUninstallCount: retryUninstalls.length,
    }, {
      failedClosed: true,
      retainedCount: 1,
      releaseStorageProofAfterAmbiguousStatus: true,
      uninstallCount: 0,
      retryFailedClosed: true,
      sameEvidenceRetainedForRetry: true,
      retryReleaseStorageProofAfterAmbiguousStatus: true,
      retryUninstallCount: 0,
    }, 'a generic 404 substring was accepted as release absence without a verifiable Helm storage UID/API check')
    assert.match(
      `${invocation.output}\n${retry?.output ?? ''}`,
      /could not establish Helm release absence|ambiguous (?:Helm )?status|transport\/auth\/server/i,
      'ambiguous Helm 404 cleanup omitted an actionable fail-closed status diagnostic',
    )
  } finally { invocation.cleanup() }
})

// bbx-933-008 | fn-e2e-preserve-existing-namespace | OpenSpec #### Scenario: Existing namespace E2E execution is explicitly attested and non-destructive
test('preserve health cannot declare an empty release workload selector healthy', () => {
  const invocation = invokeHarness('empty-health-selector', {
    E2E_NAMESPACE_MODE: 'preserve-existing',
    E2E_EXPECTED_NAMESPACE_UID: namespaceUid,
  })
  try {
    const healthReads = invocation.calls.filter(({ command, args }) => command === 'kubectl'
      && /(?:^|\s)get\s+(?:deployment|statefulset|pod|pods)(?:\s|$)/.test(args)
      && /app\.kubernetes\.io\/instance=falcone/.test(args))
    const issueRuns = invocation.calls.filter(({ command, args }) => command === 'npx' && /(?:^|\s)playwright\s+test(?:\s|$)/.test(args))
    assert.deepEqual({
      failedClosed: invocation.result.status !== 0,
      releaseScopedHealthRead: healthReads.length > 0,
      issueRuns: issueRuns.length,
      installed: releaseInstalls(invocation).length,
    }, {
      failedClosed: true,
      releaseScopedHealthRead: true,
      issueRuns: 0,
      installed: 1,
    }, 'zero selected release workloads were accepted as a healthy deployment')
    assert.match(invocation.output, /health|workload|selector|target|empty|zero|release/i, 'empty health selection omitted actionable evidence')
  } finally { invocation.cleanup() }
})

/**
 * Static readiness coverage for make-all-services-core (#898).
 *
 * These tests exercise the install source of truth without touching a cluster:
 * Helm must render in an arbitrary release namespace, core disable switches must
 * fail closed, OpenBao/ESO credential mappings must stay aligned, Temporal must
 * bootstrap its DB role from the canonical Secret, and MCP routes/RBAC must target
 * the Helm-owned executor.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAllDocuments } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CHART_REPO_ROOT = resolve(REPO_ROOT, '..', 'falcone-charts');
const CHART_PATH = resolve(CHART_REPO_ROOT, 'charts', 'in-falcone');
const KIND_VALUES = resolve(CHART_REPO_ROOT, 'deploy', 'kind', 'values-kind.yaml');
const OPENSHIFT_VALUES = resolve(CHART_REPO_ROOT, 'deploy', 'openshift', 'values-openshift.yaml');
const E2E_FLOWS_VALUES = resolve(CHART_REPO_ROOT, 'tests', 'e2e', 'values-flows-e2e.yaml');
const E2E_FERRETDB_VALUES = resolve(CHART_REPO_ROOT, 'tests', 'e2e', 'values-ferretdb-realtime-e2e.yaml');
const CUTOVER_SCRIPTS = resolve(REPO_ROOT, 'scripts', 'system-changes', 'make-all-services-core');

function helmAvailable() {
  return spawnSync('helm', ['version', '--short'], { encoding: 'utf8' }).status === 0;
}
const SKIP = helmAvailable() ? false : { skip: 'helm binary not available on PATH' };
function dockerAvailable() {
  return spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' }).status === 0;
}
const DOCKER_SKIP = dockerAvailable() ? false : { skip: 'docker daemon not available on PATH' };

function helmTemplate(args = []) {
  return spawnSync('helm', ['template', 'falcone', CHART_PATH, '--namespace', 'review-ns', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 96 * 1024 * 1024,
  });
}

function assertRender(args = []) {
  const r = helmTemplate(args);
  assert.equal(r.status, 0, `helm template must succeed.\nstderr: ${r.stderr}`);
  return r.stdout;
}
function assertHelmFails(args, pattern, label) {
  const r = helmTemplate(args);
  assert.notEqual(r.status, 0, `${label} must fail`);
  assert.match(r.stderr, pattern, `${label} must explain the invalid all-core override.\nstderr: ${r.stderr}`);
  return r;
}
function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function renderDocs(args = []) {
  return parseAllDocuments(assertRender(args)).map((doc) => doc.toJSON()).filter(Boolean);
}
function parseValuesFile(path) {
  const docs = parseAllDocuments(readFileSync(path, 'utf8'));
  assert.deepEqual(docs.flatMap((doc) => doc.errors), [], `${path} must parse as YAML`);
  assert.equal(docs.length, 1, `${path} must contain one YAML document`);
  return docs[0].toJSON() ?? {};
}
function findDoc(docs, kind, name) {
  return docs.find((doc) => doc.kind === kind && doc.metadata?.name === name);
}
function roleBindingSubject(docs, name) {
  const binding = findDoc(docs, 'RoleBinding', name);
  return binding?.subjects?.find((subject) => subject.kind === 'ServiceAccount');
}
function imageList(docs) {
  const images = [];
  for (const doc of docs) {
    const podSpecs = [
      doc.kind === 'Pod' ? doc.spec : null,
      doc.spec?.template?.spec,
      doc.spec?.jobTemplate?.spec?.template?.spec,
    ].filter(Boolean);
    for (const podSpec of podSpecs) {
      for (const container of [...(podSpec.initContainers ?? []), ...(podSpec.containers ?? [])]) {
        if (container.image) images.push(container.image);
      }
    }
  }
  return images;
}
function podSpecEntries(docs) {
  const entries = [];
  for (const doc of docs) {
    const podSpec = doc.kind === 'Pod' ? doc.spec : doc.spec?.template?.spec;
    if (podSpec) entries.push({ doc, podSpec });
  }
  return entries;
}
function hookKinds(docs, hooks) {
  return docs.filter((doc) => {
    const hook = doc.metadata?.annotations?.['helm.sh/hook'];
    return typeof hook === 'string' && hooks.some((entry) => hook.split(',').includes(entry));
  });
}
function envValue(job, name) {
  const containers = job.spec?.template?.spec?.containers ?? [];
  for (const container of containers) {
    const env = container.env ?? [];
    const match = env.find((entry) => entry.name === name);
    if (match) return match.value;
  }
  return undefined;
}
function commandText(job) {
  return (job.spec?.template?.spec?.containers ?? [])
    .flatMap((container) => [...(container.command ?? []), ...(container.args ?? [])])
    .join('\n');
}

test('all-core-001: arbitrary release namespace is used consistently', SKIP, () => {
  const out = assertRender();
  const docs = parseAllDocuments(out).map((doc) => doc.toJSON()).filter(Boolean);
  assert.equal(findDoc(docs, 'Namespace', 'review-ns'), undefined, 'release Namespace must be created by Helm --create-namespace, not rendered as a normal chart resource');
  assert.match(out, /namespace:\s*review-ns/, 'namespaced resources must render in the release namespace');
  assert.doesNotMatch(out, /namespace:\s*in-falcone-dev\b|name:\s*in-falcone-dev\b/, 'global.namespace must not leak into rendered manifests');
  assert.match(out, /kind:\s*NetworkPolicy[\s\S]*name:\s*openbao-access-policy[\s\S]*kubernetes\.io\/metadata\.name:\s*review-ns/, 'OpenBao NetworkPolicy must allow the Helm-created release namespace by name');
});

test('all-core-001b: install docs use Helm create-namespace while the chart owns support namespaces', () => {
  const valuesDoc = parseAllDocuments(readFileSync(resolve(CHART_PATH, 'values.yaml'), 'utf8'))[0].toJSON();
  assert.equal(valuesDoc.global?.createNamespace, true, 'default fresh installs must let the chart render required support namespaces');

  const files = [
    'docs-site/guide/installation.md',
    'docs-site/operations/helm-configuration.md',
  ];
  for (const rel of files) {
    const text = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
    assert.match(text, /--create-namespace\b/, `${rel} must ask Helm to create the release namespace before pre-install hooks`);
    assert.match(text, /global\.createNamespace=true/, `${rel} must document chart-owned support namespace creation`);
    assert.match(text, /global\.createNamespace=false/, `${rel} must document the fully pre-created namespace path`);
  }
});

test('all-core-002: legacy enabled=false switches fail for every core service alias', SKIP, () => {
  const aliases = [
    'bootstrap',
    'apisix',
    'keycloak',
    'postgresql',
    'postgresqlVector',
    'documentdb',
    'ferretdb',
    'kafka',
    'seaweedfs',
    'grafana',
    'observability',
    'controlPlane',
    'controlPlaneExecutor',
    'webConsole',
    'workflowWorker',
    'eso',
    'openbao',
    'temporal',
    'mcp',
  ];
  for (const alias of aliases) {
    const r = helmTemplate(['--set', `${alias}.enabled=false`]);
    assert.notEqual(r.status, 0, `${alias}.enabled=false must fail`);
    assert.match(r.stderr, /no longer supported|cannot be disabled/i, `${alias}.enabled=false must explain core-service optionality`);
  }
});

test('all-core-002b: zero replicas fail closed for every core workload role', SKIP, () => {
  const componentReplicas = [
    'apisix',
    'keycloak',
    'postgresql',
    'postgresqlVector',
    'documentdb',
    'ferretdb',
    'kafka',
    'observability',
    'controlPlane',
    'controlPlaneExecutor',
    'webConsole',
    'workflowWorker',
  ];
  for (const component of componentReplicas) {
    assertHelmFails(
      ['--set', `${component}.replicas=0`],
      new RegExp(`${escapeRe(component)}\\.replicas|replicas.*(least|greater than or equal|minimum)`, 'i'),
      `${component}.replicas=0`,
    );
  }

  for (const role of ['frontend', 'history', 'matching', 'worker']) {
    assertHelmFails(
      ['--set', `temporal.${role}.replicas=0`],
      new RegExp(`temporal\\.${role}\\.replicas|replicas.*(least|greater than or equal|minimum)`, 'i'),
      `temporal.${role}.replicas=0`,
    );
  }

  assertHelmFails(
    ['--set', 'openbao.openbao.replicas=0'],
    /openbao\.openbao\.replicas|replicas.*(least|greater than or equal|minimum)/i,
    'openbao.openbao.replicas=0',
  );

  for (const role of ['master', 'volume', 'filer', 's3']) {
    assertHelmFails(
      ['--set', `seaweedfs.${role}.replicas=0`],
      new RegExp(`seaweedfs\\.${role}\\.replicas|replicas.*(least|greater than or equal|minimum)`, 'i'),
      `seaweedfs.${role}.replicas=0`,
    );
  }

  for (const path of [
    'eso.external-secrets.replicaCount',
    'eso.external-secrets.webhook.replicaCount',
    'eso.external-secrets.certController.replicaCount',
  ]) {
    assertHelmFails(
      ['--set', `${path}=0`],
      new RegExp(`${escapeRe(path)}|replicaCount.*(least|greater than or equal|minimum)`, 'i'),
      `${path}=0`,
    );
  }
});

test('all-core-002c: nested core role disable toggles fail without blocking helper toggles', SKIP, () => {
  for (const role of ['frontend', 'history', 'matching', 'worker']) {
    assertHelmFails(
      ['--set', `temporal.${role}.enabled=false`],
      new RegExp(`temporal\\.${role}\\.enabled|server roles are core|enabled.*true`, 'i'),
      `temporal.${role}.enabled=false`,
    );
  }
  assertHelmFails(
    ['--set', 'openbao.openbao.enabled=false'],
    /openbao\.openbao\.enabled|OpenBao StatefulSet is core|enabled.*true/i,
    'openbao.openbao.enabled=false',
  );
  for (const role of ['master', 'volume', 'filer', 's3']) {
    assertHelmFails(
      ['--set', `seaweedfs.${role}.enabled=false`],
      new RegExp(`seaweedfs\\.${role}\\.enabled|storage role|enabled.*true`, 'i'),
      `seaweedfs.${role}.enabled=false`,
    );
  }
  for (const path of [
    'documentdb.initJob.enabled',
    'eso.external-secrets.installCRDs',
    'eso.external-secrets.webhook.create',
    'eso.external-secrets.certController.create',
  ]) {
    assertHelmFails(
      ['--set', `${path}=false`],
      new RegExp(`${escapeRe(path)}|ESO|CRDs|enabled.*true`, 'i'),
      `${path}=false`,
    );
  }

  assertRender([
    '--set', 'postgresql.volumePermissions.enabled=false',
    '--set', 'seaweedfs.volume.resizeHook.enabled=false',
    '--set', 'openbao.openbao.auditSidecar.enabled=false',
    '--set', 'openbao.openbao.migration.enabled=false',
  ]);
});

test('all-core-003: nested service.enabled=false fails for core service components', SKIP, () => {
  const serviceComponents = [
    'apisix',
    'keycloak',
    'postgresql',
    'postgresqlVector',
    'documentdb',
    'ferretdb',
    'kafka',
    'observability',
    'controlPlane',
    'controlPlaneExecutor',
    'webConsole',
    'workflowWorker',
  ];
  for (const component of serviceComponents) {
    const r = helmTemplate(['--set', `${component}.service.enabled=false`]);
    assert.notEqual(r.status, 0, `${component}.service.enabled=false must fail`);
    assert.match(r.stderr, /core platform service unreachable/i, `${component}.service.enabled=false must explain service reachability`);
  }
});

test('all-core-004: OpenBao seeding and ESO remoteRefs are aligned', SKIP, () => {
  const out = assertRender();
  const docs = renderDocs();
  const expected = [
    ['KAFKA_CFG_NODE_ID', 'platform/kafka', 'node-id'],
    ['KAFKA_CFG_PROCESS_ROLES', 'platform/kafka', 'KAFKA_CFG_PROCESS_ROLES'],
    ['KAFKA_CFG_CONTROLLER_LISTENER_NAMES', 'platform/kafka', 'KAFKA_CFG_CONTROLLER_LISTENER_NAMES'],
    ['KAFKA_CFG_CONTROLLER_QUORUM_VOTERS', 'platform/kafka', 'KAFKA_CFG_CONTROLLER_QUORUM_VOTERS'],
    ['KAFKA_CFG_LISTENERS', 'platform/kafka', 'KAFKA_CFG_LISTENERS'],
    ['KAFKA_CFG_ADVERTISED_LISTENERS', 'platform/kafka', 'KAFKA_CFG_ADVERTISED_LISTENERS'],
    ['KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP', 'platform/kafka', 'KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP'],
    ['password', 'platform/temporal', 'password'],
    ['realtime-url', 'platform/documentdb-replication', 'realtime-url'],
    ['master-key', 'platform/encryption', 'master-key'],
  ];
  for (const [secretKey, remoteKey, property] of expected) {
    assert.match(out, new RegExp(`secretKey:\\s*${escapeRe(secretKey)}[\\s\\S]*remoteRef:\\s*\\{\\s*key:\\s*${escapeRe(remoteKey)},\\s*property:\\s*${escapeRe(property)}\\s*\\}`), `${secretKey} must map to ${remoteKey}/${property}`);
  }
  for (const property of ['node-id', 'KAFKA_CFG_NODE_ID', 'KAFKA_CFG_PROCESS_ROLES', 'KAFKA_CFG_CONTROLLER_LISTENER_NAMES', 'KAFKA_CFG_CONTROLLER_QUORUM_VOTERS', 'KAFKA_CFG_LISTENERS', 'KAFKA_CFG_ADVERTISED_LISTENERS', 'KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP']) {
    assert.match(out, new RegExp(`${property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}="\\$\\(cred in-falcone-kafka`), `OpenBao init must seed Kafka property ${property}`);
  }
  assert.match(out, /kv_merge secret\/platform\/temporal[\s\S]*visibility-database="\$\(cred in-falcone-temporal visibility-database\)"/, 'OpenBao init must seed Temporal credentials without clobbering unmapped properties');
  assert.match(out, /kv_merge secret\/platform\/encryption[\s\S]*master-key="\$\(cred in-falcone-encryption master-key\)"/, 'OpenBao init must seed encryption key without clobbering unmapped properties');
  assert.match(out, /--from-file=root-token=\/openbao-recovery\/root-token/, 'OpenBao recovery Secret must preserve the root token for partial init convergence');
  assert.match(out, /cp \/openbao-recovery-mounted\/root-token \/openbao-recovery\/root-token[\s\S]*\[ -s \/openbao-recovery\/unseal1 \] && \[ -s \/openbao-recovery\/root-token \]/, 'initialized recovery branches must not signal .ready without a root token');
  assert.match(out, /openbao-recovery-mounted\/root-token[\s\S]*openbao-init-role login failed/, 'OpenBao init must fall back to mounted recovery root token before Kubernetes-auth login failures');
  const openbaoInit = findDoc(docs, 'Job', 'openbao-init');
  assert.ok(openbaoInit, 'OpenBao init convergence Job must render');
  const openbaoInitTemplate = readFileSync(resolve(CHART_PATH, 'charts', 'openbao', 'templates', 'openbao-init-job.yaml'), 'utf8');
  assert.match(openbaoInitTemplate, /"helm\.sh\/hook":\s*post-install,post-upgrade/);
  assert.match(openbaoInitTemplate, /"helm\.sh\/hook-weight":\s*"-4"/);
  assert.match(openbaoInitTemplate, /"helm\.sh\/hook-delete-policy":\s*before-hook-creation/);
  const credentialHook = findDoc(docs, 'Job', 'falcone-in-falcone-credential-bootstrap');
  assert.ok(credentialHook, 'platform credential bootstrap hook must render');
  assert.equal(credentialHook.metadata?.annotations?.['helm.sh/hook'], 'pre-install,pre-upgrade');
  assert.equal(credentialHook.metadata?.annotations?.['helm.sh/hook-weight'], '-30');
  const credentialScript = commandText(credentialHook);
  assert.match(credentialScript, /random_alnum\(\)/, 'platform credentials must be generated inside the hook pod');
  assert.match(credentialScript, /kubectl -n "\$release_ns" create secret generic "\$secret_name"/, 'credential hook must create/adopt Kubernetes Secrets in-cluster');
  for (const secretName of [
    'in-falcone-postgresql',
    'in-falcone-postgresql-vector',
    'in-falcone-documentdb',
    'in-falcone-ferretdb',
    'in-falcone-documentdb-replication',
    'in-falcone-kafka',
    'in-falcone-storage',
    'in-falcone-seaweedfs-s3-creds',
    'in-falcone-seaweedfs-s3-config',
    'falcone-seaweedfs-db-secret',
    'in-falcone-keycloak-admin',
    'in-falcone-identity-client',
    'in-falcone-superadmin',
    'in-falcone-apisix-admin',
    'in-falcone-gateway-shared-secret',
    'in-falcone-temporal',
    'in-falcone-encryption',
  ]) {
    assert.equal(findDoc(docs, 'Secret', secretName), undefined, `${secretName} must be created by the credential hook, not rendered with live data`);
  }
  for (const secretName of [
    'in-falcone-postgresql',
    'in-falcone-postgresql-vector',
    'in-falcone-documentdb',
    'in-falcone-ferretdb',
    'in-falcone-documentdb-replication',
    'in-falcone-kafka',
    'in-falcone-storage',
    'in-falcone-keycloak-admin',
    'in-falcone-identity-client',
    'in-falcone-superadmin',
    'in-falcone-apisix-admin',
    'in-falcone-temporal',
    'in-falcone-encryption',
  ]) {
    assert.match(credentialScript, new RegExp(`begin_secret ${escapeRe(secretName)}\\b`), `${secretName} must be covered by the credential hook`);
  }
  assert.match(credentialScript, /begin_secret "\$S3_CREDS_SECRET" seaweedfs-s3/, 'SeaweedFS S3 credential Secret must be covered by the credential hook');
  assert.match(credentialScript, /begin_secret "\$S3_CONFIG_SECRET" seaweedfs-s3/, 'SeaweedFS S3 config Secret must be covered by the credential hook');
  assert.match(credentialScript, /seaweed_db_secret="\$\{RELEASE_NAME\}-seaweedfs-db-secret"[\s\S]*begin_secret "\$seaweed_db_secret" seaweedfs/, 'SeaweedFS DB Secret must be covered by the credential hook');
  assert.match(credentialScript, /begin_secret "\$GATEWAY_SHARED_SECRET_NAME" gateway/, 'gateway shared Secret must be covered by the credential hook when chart-managed');
  assert.doesNotMatch(out, /randAlphaNum/, 'default render must not use Helm-side random credential generation');
  for (const renderArgs of [[], ['--include-crds']]) {
    const renderedDocs = renderArgs.length === 0 ? docs : parseAllDocuments(assertRender(renderArgs)).map((doc) => doc.toJSON()).filter(Boolean);
    for (const secret of renderedDocs.filter((doc) => doc.kind === 'Secret')) {
      assert.equal(secret.stringData, undefined, `${secret.metadata?.name} must not render inline stringData for args ${renderArgs.join(' ') || '(base)'}`);
      assert.equal(secret.data, undefined, `${secret.metadata?.name} must not render inline data for args ${renderArgs.join(' ') || '(base)'}`);
    }
  }
});

test('all-core-005: Temporal DB bootstrap is wired before schema setup', SKIP, () => {
  const out = assertRender();
  const docs = renderDocs();
  const dbBootstrap = findDoc(docs, 'Job', 'falcone-temporal-db-bootstrap');
  const schema = findDoc(docs, 'Job', 'falcone-temporal-schema');
  const schemaScript = commandText(schema);
  assert.equal(dbBootstrap?.metadata?.annotations?.['helm.sh/hook'], undefined, 'fresh-install DB bootstrap must be a normal Job because PostgreSQL belongs to the same release');
  assert.equal(schema?.metadata?.annotations?.['helm.sh/hook'], undefined, 'fresh-install schema setup must be a normal Job because PostgreSQL belongs to the same release');
  assert.match(out, /CREATE ROLE %I LOGIN CREATEDB PASSWORD %L/, 'Temporal bootstrap must create the role idempotently');
  assert.match(out, /name:\s*"in-falcone-temporal"[\s\S]*key:\s*"password"/, 'Temporal schema/bootstrap must use the generated Temporal Secret');
  assert.match(out, /SQL_USER[\s\S]*value:\s*"temporal"[\s\S]*SQL_PASSWORD[\s\S]*secretKeyRef:/, 'Temporal schema job must use the same role and Secret');
  assert.match(schemaScript, /schema_lifecycle="install"/, 'fresh install schema Job must render the install lifecycle branch');
  assert.match(schemaScript, /create-database[\s\S]*setup-schema -v 0\.0[\s\S]*update-schema/, 'fresh install schema Job must create/setup/update schemas in order');
  assert.doesNotMatch(schemaScript, /\|\|\s*true/, 'fresh install schema Job must not hide temporal-sql-tool failures with unconditional || true');
});

test('all-core-005b: Temporal schema upgrade skips setup and runs only safe updates', SKIP, () => {
  const installDocs = renderDocs();
  const upgradeDocs = renderDocs(['--is-upgrade', '--set', 'deployment.upgrade.currentVersion=0.2.0']);
  const installSchema = findDoc(installDocs, 'Job', 'falcone-temporal-schema');
  const upgradeDbBootstrap = findDoc(upgradeDocs, 'Job', 'falcone-temporal-db-bootstrap');
  const upgradeSchema = findDoc(upgradeDocs, 'Job', 'falcone-temporal-schema');
  const installScript = commandText(installSchema);
  const upgradeScript = commandText(upgradeSchema);

  assert.equal(upgradeDbBootstrap?.metadata?.annotations?.['helm.sh/hook'], 'pre-upgrade', 'upgrade DB bootstrap must run before rollout');
  assert.equal(upgradeSchema?.metadata?.annotations?.['helm.sh/hook'], 'pre-upgrade', 'upgrade schema Job must run before rollout');
  assert.equal(upgradeDbBootstrap?.metadata?.annotations?.['helm.sh/hook-weight'], '-1', 'DB bootstrap must run before schema update on upgrade');
  assert.equal(upgradeSchema?.metadata?.annotations?.['helm.sh/hook-weight'], '0', 'schema update must run after DB bootstrap on upgrade');
  assert.match(installScript, /schema_lifecycle="install"/, 'install render must carry install lifecycle script');
  assert.match(upgradeScript, /schema_lifecycle="upgrade"/, 'upgrade render must carry upgrade lifecycle script');
  assert.notEqual(upgradeScript, installScript, 'fresh install and upgrade schema scripts must differ');
  assert.match(upgradeScript, /\$\{SQL\} --database "\$\{db\}" update-schema -d "\$\{dir\}"/, 'upgrade schema helper must run update-schema for the supplied schema directory');
  assert.match(upgradeScript, /update_temporal_schema "\$\{SQL_DATABASE\}" \/etc\/temporal\/schema\/postgresql\/v12\/temporal\/versioned/, 'upgrade schema Job must update the primary schema');
  assert.match(upgradeScript, /update_temporal_schema "\$\{SQL_VISIBILITY_DATABASE\}" \/etc\/temporal\/schema\/postgresql\/v12\/visibility\/versioned/, 'upgrade schema Job must update the visibility schema');
  assert.doesNotMatch(upgradeScript, /setup-schema -v 0\.0/, 'upgrade schema Job must not rerun setup-schema');
  assert.doesNotMatch(upgradeScript, /\|\|\s*true/, 'upgrade schema Job must not hide temporal-sql-tool failures with unconditional || true');
});

test('all-core-006: Helm owns the /v1/mcp route, executor RBAC, and pullable default image refs', SKIP, () => {
  const ciWorkflow = readFileSync(resolve(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const pinnedChartRef = ciWorkflow.match(/FALCONE_CHARTS_REF:\s*['"]([0-9a-f]{40})['"]/)?.[1];
  assert.ok(pinnedChartRef, 'CI must pin the sibling falcone-charts checkout to a full commit SHA');
  const chartHead = spawnSync('git', ['-C', CHART_REPO_ROOT, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  });
  assert.equal(chartHead.status, 0, `sibling chart checkout must expose its pinned commit: ${chartHead.stderr}`);
  assert.equal(
    chartHead.stdout.trim(),
    pinnedChartRef,
    'all-core image assertions must run against the exact CI-pinned sibling chart checkout',
  );

  const base = assertRender();
  const baseImages = imageList(parseAllDocuments(base).map((doc) => doc.toJSON()).filter(Boolean));
  assert.match(base, /route-2018-mcp\.json:[\s\S]*"uri": "\/v1\/mcp\/\*"/, 'bootstrap payload must include the MCP APISIX route');
  assert.match(base, /falcone-control-plane-executor\.review-ns\.svc\.cluster\.local:8080/, 'MCP route must target the Helm-owned executor service');
  assert.match(base, /kind:\s*RoleBinding[\s\S]*name:\s*falcone-mcp-runtime[\s\S]*namespace:\s*review-ns[\s\S]*kind:\s*ServiceAccount[\s\S]*name:\s*falcone-control-plane-executor[\s\S]*namespace:\s*review-ns/, 'MCP RBAC must bind the executor service account in the release namespace');
  assert.doesNotMatch(base, /ghcr\.io\/example/, 'fresh install values must not use example image repositories');
  assert.doesNotMatch(base, /localhost:30500\/in-falcone-/, 'fresh install base values must not render localhost-only project images');
  assert.doesNotMatch(base, /image:\s*['"]?docker\.io\/bitnami\/(postgresql:17\.2\.0|kafka:3\.9\.0|kubectl:1\.32\.2)/, 'fresh install must not render removed bitnami image tags');
  const removedKubectlImage = ['docker.io', 'bitnamilegacy', 'kubectl:1.32.2'].join('/');
  assert.equal(baseImages.includes(removedKubectlImage), false, 'bootstrap jobs must not use kubectl-only images without bash/curl/jq');
  assert.doesNotMatch(base, /image:\s*"docker\.io\/apache\/apisix:3\.10\.0"/, 'fresh install must not render the missing APISIX tag');
  assert.doesNotMatch(base, /image:\s*"docker\.io\/prom\/prometheus:3\.2\.1"/, 'fresh install must not render the missing Prometheus tag');
  assert.match(base, /image:\s*"docker\.io\/apache\/apisix:3\.10\.0-debian"/, 'APISIX must use the verified pullable Debian tag');
  assert.match(base, /image:\s*"docker\.io\/prom\/prometheus@sha256:6927e0919a144aa7616fd0137d4816816d42f6b816de3af269ab065250859a62"/, 'Prometheus must use the verified v3.2.1 manifest digest');
  assert.match(base, /image:\s*"docker\.io\/bitnamilegacy\/postgresql:17\.2\.0"/, 'PostgreSQL must use the verified bitnamilegacy image');
  assert.match(base, /image:\s*"docker\.io\/bitnamilegacy\/kafka:3\.9\.0"/, 'Kafka must use the verified bitnamilegacy image');
  assert.ok(baseImages.includes('docker.io/alpine/k8s:1.32.2'), 'bootstrap jobs must use the verified alpine/k8s image with bash, curl, jq, and kubectl');
  assert.match(
    base,
    /image:\s*"ghcr\.io\/gntik-ai\/in-falcone-control-plane@sha256:27aedbfabdc8b72baae844b14dbdf72820c0f4d548a49013118d9ba7e0588d40"/,
    'control plane must use the published C-25 image digest',
  );
  const compatibleReleaseTags = new Map([
    ['in-falcone-control-plane-executor', '0.3.0'],
    ['in-falcone-workflow-worker', '0.3.0'],
    ['in-falcone-web-console', '0.3.0'],
  ]);
  for (const [image, expectedTag] of compatibleReleaseTags) {
    assert.match(
      base,
      new RegExp(`image:\\s*"ghcr\\.io/gntik-ai/${image}:${escapeRe(expectedTag)}"`),
      `${image} must use its declared C-25-compatible release tag`,
    );
  }
  assert.match(base, /name:\s*in-falcone-runtime-env[\s\S]*MCP_RUNTIME_IMAGE:\s*"ghcr\.io\/gntik-ai\/in-falcone-mcp-runtime:0\.3\.0"/, 'default MCP runtime env must use the chart app release tag from the runtime env ConfigMap');
  assert.match(base, /name:\s*falcone-control-plane[\s\S]*envFrom:[\s\S]*name:\s*in-falcone-runtime-env/, 'control-plane must consume the parent-rendered runtime env ConfigMap');
  assert.match(base, /name:\s*falcone-control-plane-executor[\s\S]*envFrom:[\s\S]*name:\s*in-falcone-runtime-env/, 'executor must consume the parent-rendered runtime env ConfigMap');
  assert.doesNotMatch(base, /ghcr\.io\/gntik-ai\/in-falcone-[^:\s"]+:(0\.1\.0|0\.2\.11|0\.6\.2|0\.9\.3)/, 'first-party defaults must not mix stale component tags');
  const valuesYaml = readFileSync(resolve(CHART_PATH, 'values.yaml'), 'utf8');
  assert.match(valuesYaml, /mcp:\n[\s\S]*runtimeImage:\n[\s\S]*repository:\s*ghcr\.io\/gntik-ai\/in-falcone-mcp-runtime\n[\s\S]*tag:\s*0\.3\.0/, 'mcp.runtimeImage values must use the chart app release tag');

  const kind = assertRender(['-f', KIND_VALUES]);
  assert.match(kind, /image:\s*"localhost:30500\/in-falcone-control-plane-executor:0\.9\.3"/, 'kind overlay must use the local executor image');
  assert.match(kind, /image:\s*"localhost:30500\/in-falcone-workflow-worker:0\.1\.0"/, 'kind overlay must use the local workflow-worker image');
  assert.match(kind, /image:\s*"localhost:30500\/in-falcone-web-console:0\.2\.11"/, 'kind overlay must use the local web-console image');
  assert.match(kind, /MCP_RUNTIME_IMAGE:\s*"localhost:30500\/in-falcone-mcp-runtime"/, 'kind overlay must use the local MCP runtime image via mcp.runtimeImage');
  assert.doesNotMatch(kind, /MCP_RUNTIME_IMAGE_DIGEST/, 'kind overlay must not carry an unverified MCP runtime digest');

  const releaseWorkflow = readFileSync(resolve(REPO_ROOT, '.github', 'workflows', 'release-images.yml'), 'utf8');
  const mcpDockerfile = readFileSync(resolve(REPO_ROOT, 'apps', 'mcp-runtime', 'Dockerfile'), 'utf8');
  const allCoreInstallDoc = readFileSync(resolve(REPO_ROOT, 'docs', 'installation', 'all-core-platform-services.md'), 'utf8');
  assert.match(releaseWorkflow, /image:\s*in-falcone-mcp-runtime[\s\S]*dockerfile:\s*apps\/mcp-runtime\/Dockerfile/, 'release workflow must publish the MCP runtime image');
  assert.match(mcpDockerfile, /COPY apps\/control-plane-executor\/src\/mcp-official-server\.mjs/, 'MCP runtime image must build from the production MCP server modules');
  assert.match(allCoreInstallDoc, /GitHub Actions run\s*\n`29152340476`/, 'all-core install docs must record the six-image publication run');
  for (const image of [
    'in-falcone-control-plane',
    'in-falcone-control-plane-executor',
    'in-falcone-web-console',
    'in-falcone-workflow-worker',
    'in-falcone-fn-runtime',
    'in-falcone-mcp-runtime',
  ]) {
    assert.match(allCoreInstallDoc, new RegExp(`${escapeRe(image)}[\\s\\S]*0\\.3\\.0|0\\.3\\.0[\\s\\S]*${escapeRe(image)}`), `all-core install docs must list ${image}:0.3.0`);
  }
  assert.doesNotMatch(allCoreInstallDoc, /29150940923/, 'all-core install docs must not retain the stale five-image Actions run');
});

test('all-core-006c: bootstrap image contains required command-line tools', DOCKER_SKIP, () => {
  const r = spawnSync('docker', [
    'run',
    '--rm',
    '--entrypoint',
    '/bin/sh',
    'docker.io/alpine/k8s:1.32.2',
    '-ec',
    'for c in bash curl jq kubectl; do command -v "$c" >/dev/null || exit 1; done',
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(r.status, 0, `alpine/k8s bootstrap image must contain bash, curl, jq, and kubectl.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
});

test('all-core-007: ESO operator, webhook, cert-controller, CRDs, and auxiliary namespaces render', SKIP, () => {
  const vendoredChart = readFileSync(resolve(CHART_PATH, 'charts', 'eso', 'charts', 'external-secrets', 'Chart.yaml'), 'utf8');
  const nestedLock = readFileSync(resolve(CHART_PATH, 'charts', 'eso', 'Chart.lock'), 'utf8');
  const vendoring = readFileSync(resolve(CHART_PATH, 'charts', 'eso', 'VENDORING.md'), 'utf8');
  assert.match(vendoredChart, /name:\s*external-secrets/, 'ESO wrapper must vendor the upstream external-secrets chart');
  assert.match(vendoredChart, /version:\s*0\.9\.0/, 'vendored external-secrets chart version must match the wrapper dependency pin');
  assert.match(nestedLock, /name:\s*external-secrets[\s\S]*version:\s*0\.9\.0/, 'ESO wrapper must carry a nested lock for the vendored upstream chart');
  assert.match(vendoring, /unpacked chart/, 'ESO wrapper must document that the unpacked chart is intentionally tracked');
  const docs = renderDocs();
  assert.equal(findDoc(docs, 'Namespace', 'review-ns'), undefined, 'release namespace must be left to Helm --create-namespace so pre-install hooks can start without ownership conflicts');
  assert.ok(findDoc(docs, 'Namespace', 'eso-system'), 'ESO auth namespace must render for a fresh install');
  assert.ok(findDoc(docs, 'Namespace', 'secret-store'), 'OpenBao namespace must render for a fresh install');
  assert.equal(findDoc(docs, 'Deployment', 'eso-external-secrets')?.metadata?.namespace, 'eso-system', 'ESO controller Deployment must run in the configured ESO namespace');
  assert.equal(findDoc(docs, 'Deployment', 'eso-external-secrets-webhook')?.metadata?.namespace, 'eso-system', 'ESO admission webhook Deployment must run in the configured ESO namespace');
  assert.equal(findDoc(docs, 'Deployment', 'eso-external-secrets-cert-controller')?.metadata?.namespace, 'eso-system', 'ESO cert-controller Deployment must run in the configured ESO namespace');
  assert.ok(findDoc(docs, 'CustomResourceDefinition', 'externalsecrets.external-secrets.io'), 'ExternalSecret CRD must render from the vendored dependency');
  assert.ok(findDoc(docs, 'CustomResourceDefinition', 'clustersecretstores.external-secrets.io'), 'ClusterSecretStore CRD must render from the vendored dependency');
  const clusterStore = findDoc(docs, 'ClusterSecretStore', 'openbao-backend');
  assert.equal(clusterStore?.metadata?.labels?.['app.kubernetes.io/instance'], 'falcone', 'ClusterSecretStore must carry release ownership labels for scoped rollback');
  assert.equal(clusterStore?.metadata?.labels?.['app.kubernetes.io/part-of'], 'in-falcone', 'ClusterSecretStore must be labeled as Falcone-owned');
  assert.equal(clusterStore?.metadata?.annotations?.['meta.helm.sh/release-name'], 'falcone', 'ClusterSecretStore must carry Helm ownership metadata');
  assert.equal(clusterStore?.metadata?.annotations?.['meta.helm.sh/release-namespace'], 'review-ns', 'ClusterSecretStore must carry Helm release namespace metadata');
  const out = assertRender();
  assert.doesNotMatch(out, /eso-crd-extract-external-secrets-webhook/, 'stale extracted CRD webhook names must not render');
  assert.doesNotMatch(out, /namespace:\s*default\b/, 'CRD conversion webhooks must not point at the default namespace');
  assert.match(out, /kubectl -n eso-system get endpoints eso-external-secrets-webhook/, 'webhook wait Job must wait in the namespace where the webhook Service runs');
});

test('all-core-006b: MCP runtime image and digest render from one chart value block', SKIP, () => {
  const digest = `sha256:${'a'.repeat(64)}`;
  const out = assertRender([
    '--set', 'mcp.runtimeImage.repository=ghcr.io/example/mcp-runtime',
    '--set', 'mcp.runtimeImage.tag=1.2.3',
    '--set', `mcp.runtimeImage.digest=${digest}`,
  ]);
  assert.match(out, /name:\s*in-falcone-runtime-env[\s\S]*MCP_RUNTIME_IMAGE:\s*"ghcr\.io\/example\/mcp-runtime:1\.2\.3"/, 'MCP runtime image must render from mcp.runtimeImage.repository/tag');
  assert.match(out, new RegExp(`MCP_RUNTIME_IMAGE_DIGEST:\\s*"${escapeRe(digest)}"`), 'MCP runtime digest must render from mcp.runtimeImage.digest');
  assert.doesNotMatch(out, /value:\s*ghcr\.io\/gntik-ai\/in-falcone-mcp-runtime:0\.3\.0/, 'control-plane/executor env must not hard-code MCP_RUNTIME_IMAGE outside the runtime env ConfigMap');
});

test('all-core-006f: core ServiceAccount overrides propagate to RBAC and OpenBao auth', SKIP, () => {
  const defaultDocs = renderDocs();
  assert.equal(roleBindingSubject(defaultDocs, 'falcone-function-executor')?.name, 'falcone-control-plane', 'default function RBAC must bind the rendered control-plane ServiceAccount');
  assert.equal(roleBindingSubject(defaultDocs, 'falcone-mcp-runtime')?.name, 'falcone-control-plane-executor', 'default MCP RBAC must bind the rendered executor ServiceAccount');
  assert.equal(roleBindingSubject(defaultDocs, 'falcone-prometheus-pod-discovery')?.name, 'falcone-observability', 'default observability RBAC must bind the rendered observability ServiceAccount');
  const defaultIdentities = findDoc(defaultDocs, 'ConfigMap', 'openbao-auth-identities')?.data;
  assert.equal(defaultIdentities?.['platform-service-account-names'], 'falcone-control-plane,falcone-control-plane-executor,falcone-workflow-worker,falcone-in-falcone-bootstrap');
  assert.equal(defaultIdentities?.['workspace-secrets-service-account-names'], 'falcone-control-plane,falcone-control-plane-executor');
  assert.equal(defaultIdentities?.['gateway-service-account-name'], 'falcone-apisix');
  assert.equal(defaultIdentities?.['iam-service-account-name'], 'falcone-keycloak');

  const customDocs = renderDocs([
    '--set', 'controlPlane.serviceAccount.name=custom-cp',
    '--set', 'controlPlaneExecutor.serviceAccount.name=custom-exec',
    '--set', 'workflowWorker.serviceAccount.name=custom-worker',
    '--set', 'apisix.serviceAccount.name=custom-gateway',
    '--set', 'keycloak.serviceAccount.name=custom-iam',
    '--set', 'observability.serviceAccount.name=custom-prometheus',
    '--set', 'bootstrap.serviceAccount.name=custom-bootstrap',
  ]);
  assert.equal(roleBindingSubject(customDocs, 'falcone-function-executor')?.name, 'custom-cp', 'custom function RBAC must bind the custom control-plane ServiceAccount');
  assert.equal(roleBindingSubject(customDocs, 'falcone-mcp-runtime')?.name, 'custom-exec', 'custom MCP RBAC must bind the custom executor ServiceAccount');
  assert.equal(roleBindingSubject(customDocs, 'falcone-prometheus-pod-discovery')?.name, 'custom-prometheus', 'custom observability RBAC must bind the custom observability ServiceAccount');
  const customIdentities = findDoc(customDocs, 'ConfigMap', 'openbao-auth-identities')?.data;
  assert.equal(customIdentities?.['platform-service-account-names'], 'custom-cp,custom-exec,custom-worker,custom-bootstrap');
  assert.equal(customIdentities?.['workspace-secrets-service-account-names'], 'custom-cp,custom-exec');
  assert.equal(customIdentities?.['gateway-service-account-name'], 'custom-gateway');
  assert.equal(customIdentities?.['iam-service-account-name'], 'custom-iam');

  const existingDocs = renderDocs([
    '--set', 'controlPlane.serviceAccount.create=false',
    '--set', 'controlPlane.serviceAccount.name=existing-cp',
    '--set', 'controlPlaneExecutor.serviceAccount.create=false',
    '--set', 'controlPlaneExecutor.serviceAccount.name=existing-exec',
    '--set', 'workflowWorker.serviceAccount.create=false',
    '--set', 'workflowWorker.serviceAccount.name=existing-worker',
    '--set', 'apisix.serviceAccount.create=false',
    '--set', 'apisix.serviceAccount.name=existing-gateway',
    '--set', 'keycloak.serviceAccount.create=false',
    '--set', 'keycloak.serviceAccount.name=existing-iam',
    '--set', 'observability.serviceAccount.create=false',
    '--set', 'observability.serviceAccount.name=existing-prometheus',
    '--set', 'bootstrap.serviceAccount.create=false',
    '--set', 'bootstrap.serviceAccount.name=existing-bootstrap',
  ]);
  assert.equal(roleBindingSubject(existingDocs, 'falcone-function-executor')?.name, 'existing-cp', 'existing function RBAC must bind the named external control-plane ServiceAccount');
  assert.equal(roleBindingSubject(existingDocs, 'falcone-mcp-runtime')?.name, 'existing-exec', 'existing MCP RBAC must bind the named external executor ServiceAccount');
  assert.equal(roleBindingSubject(existingDocs, 'falcone-prometheus-pod-discovery')?.name, 'existing-prometheus', 'existing observability RBAC must bind the named external observability ServiceAccount');
  assert.equal(findDoc(existingDocs, 'ServiceAccount', 'existing-cp'), undefined, 'create=false must not render the external control-plane ServiceAccount');
  const existingIdentities = findDoc(existingDocs, 'ConfigMap', 'openbao-auth-identities')?.data;
  assert.equal(existingIdentities?.['platform-service-account-names'], 'existing-cp,existing-exec,existing-worker,existing-bootstrap');
  assert.equal(existingIdentities?.['workspace-secrets-service-account-names'], 'existing-cp,existing-exec');
  assert.equal(existingIdentities?.['gateway-service-account-name'], 'existing-gateway');
  assert.equal(existingIdentities?.['iam-service-account-name'], 'existing-iam');

  const out = assertRender([
    '--set', 'controlPlane.serviceAccount.name=custom-cp',
    '--set', 'controlPlaneExecutor.serviceAccount.name=custom-exec',
  ]);
  assert.match(out, /bound_service_account_names="\$\(auth_identity workspace-secrets-service-account-names\)"/, 'OpenBao auth roles must read the parent-rendered identity map at runtime');
  assert.doesNotMatch(out, /bound_service_account_names='falcone-control-plane,falcone-control-plane-executor'/, 'OpenBao auth roles must not retain stale hard-coded control-plane identities');
});

test('all-core-006g: unnamed external core ServiceAccounts fail closed', SKIP, () => {
  for (const component of ['apisix', 'keycloak', 'postgresql', 'postgresqlVector', 'documentdb', 'ferretdb', 'kafka', 'observability', 'controlPlane', 'controlPlaneExecutor', 'webConsole', 'workflowWorker']) {
    assertHelmFails(
      ['--set', `${component}.serviceAccount.create=false`],
      new RegExp(`${escapeRe(component)}\\.serviceAccount\\.name is required|default ServiceAccount`, 'i'),
      `${component}.serviceAccount.create=false`,
    );
  }
  assertHelmFails(
    ['--set', 'bootstrap.serviceAccount.create=false'],
    /bootstrap\.serviceAccount\.name is required|default ServiceAccount/i,
    'bootstrap.serviceAccount.create=false',
  );
});

test('all-core-006h: MCP docs describe durable PostgreSQL state', () => {
  const docs = [
    'docs-site/architecture/mcp.md',
    'docs-site/guide/mcp.md',
    'docs-site/architecture/mcp-runbook.md',
    'docs-site/architecture/adrs.md',
    'docs-site/architecture/services.md',
    'docs-site/guide/roadmap.md',
  ];
  for (const rel of docs) {
    const text = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
    assert.doesNotMatch(text, /in-memory[^.\n]*(single-replica|Postgres-backed registry on the metadata pool is the next increment)/i, `${rel} must not describe MCP state as in-memory/single-replica`);
    assert.doesNotMatch(text, /does not yet serve\s+`\/v1\/mcp|management routes not wired into the runtime yet/i, `${rel} must not claim live MCP routes are still unwired`);
    assert.match(text, /(durable|durably|persist)[\s\S]{0,120}PostgreSQL|PostgreSQL[\s\S]{0,120}(durable|durably|persist)/i, `${rel} must describe MCP state as PostgreSQL-backed`);
  }
});

test('all-core-006d: OpenShift Harbor overlay renders Harbor-only coherent release images', SKIP, () => {
  const out = assertRender(['-f', OPENSHIFT_VALUES, '--include-crds']);
  const docs = parseAllDocuments(out).map((doc) => doc.toJSON()).filter(Boolean);
  const images = imageList(docs);
  assert.ok(images.length > 0, 'OpenShift render must contain workload images');
  for (const image of images) {
    assert.match(image, /^harbor\.example\.com\/falcone\//, `image must resolve to the configured Harbor registry: ${image}`);
  }
  assert.doesNotMatch(out, /\b(?:docker\.io|ghcr\.io|quay\.io|gcr\.io|registry\.k8s\.io)\//, 'Harbor render must not contain public registry references');
  assert.doesNotMatch(out, /\bin-falcone-[^:\s"']+:(?:0\.1\.0|0\.2\.11|0\.6\.2|0\.9\.3)\b/, 'OpenShift first-party images must not mix stale tags');

  for (const image of [
    'in-falcone-control-plane',
    'in-falcone-control-plane-executor',
    'in-falcone-workflow-worker',
    'in-falcone-web-console',
  ]) {
    assert.ok(images.includes(`harbor.example.com/falcone/gntik-ai/${image}:0.3.0`), `${image} must render from Harbor with the 0.3.0 release tag`);
  }
  assert.match(out, /name:\s*in-falcone-runtime-env[\s\S]*MCP_RUNTIME_IMAGE:\s*"harbor\.example\.com\/falcone\/gntik-ai\/in-falcone-mcp-runtime:0\.3\.0"/, 'OpenShift MCP runtime image must come from mcp.runtimeImage with the Harbor 0.3.0 tag');
  assert.doesNotMatch(out, /name:\s*MCP_RUNTIME_IMAGE\s*\n\s*value:/, 'workloads must consume MCP_RUNTIME_IMAGE from the runtime env ConfigMap, not hard-code it in env');
  assert.equal(envValue(findDoc(docs, 'Deployment', 'falcone-control-plane'), 'FN_RUNTIME_IMAGE'), 'harbor.example.com/falcone/gntik-ai/in-falcone-fn-runtime:0.3.0', 'OpenShift function runtime must use the Harbor 0.3.0 image');
  assert.ok(images.includes('harbor.example.com/falcone/external-secrets/external-secrets:v0.9.0'), 'external-secrets operator images must render from Harbor');
  assert.ok(images.includes('harbor.example.com/falcone/openbao/openbao:2.3.1'), 'OpenBao images must render from Harbor');
  assert.ok(images.includes('harbor.example.com/falcone/alpine/k8s:1.32.2'), 'install/helper images must render from Harbor');
});

test('all-core-006d2: every OpenShift pod is restricted-v2 and Harbor-pull coherent', SKIP, () => {
  for (const valuesPath of [resolve(CHART_PATH, 'values.yaml'), OPENSHIFT_VALUES]) {
    const source = parseAllDocuments(readFileSync(valuesPath, 'utf8'));
    assert.deepEqual(source.flatMap((doc) => doc.errors), [], `${valuesPath} must not contain duplicate mapping keys`);
  }
  const docs = renderDocs(['-f', OPENSHIFT_VALUES, '--include-crds']);
  const seaweedSecurity = findDoc(docs, 'ConfigMap', 'falcone-seaweedfs-security-config');
  assert.ok(seaweedSecurity, 'OpenShift render must include SeaweedFS security config for mTLS');
  assert.doesNotMatch(seaweedSecurity.data?.['security.toml'] ?? '', /\[jwt\.signing\]|key = "[^"]+"/, 'OpenShift render must not inline Helm-generated SeaweedFS JWT signing keys');
  const entries = podSpecEntries(docs);
  assert.ok(entries.length > 0, 'OpenShift render must contain pod specs');
  for (const { doc, podSpec } of entries) {
    const ref = `${doc.kind}/${doc.metadata?.namespace ?? 'review-ns'}/${doc.metadata?.name}`;
    for (const key of ['runAsUser', 'runAsGroup', 'fsGroup']) {
      assert.notEqual(typeof podSpec.securityContext?.[key], 'number', `${ref} must let restricted-v2 assign pod ${key}`);
    }
    for (const container of [...(podSpec.initContainers ?? []), ...(podSpec.containers ?? [])]) {
      for (const key of ['runAsUser', 'runAsGroup']) {
        assert.notEqual(typeof container.securityContext?.[key], 'number', `${ref}/${container.name} must let restricted-v2 assign ${key}`);
      }
    }
    for (const volume of podSpec.volumes ?? []) {
      assert.equal(volume.hostPath, undefined, `${ref} must not use hostPath volumes`);
    }
    const hasHarborImage = [...(podSpec.initContainers ?? []), ...(podSpec.containers ?? [])]
      .some((container) => container.image?.startsWith('harbor.example.com/falcone/'));
    if (hasHarborImage) {
      assert.ok((podSpec.imagePullSecrets ?? []).some((secret) => secret.name === 'harbor-pull'), `${ref} must carry the Harbor pull secret`);
    }
  }
  for (const [kind, name] of [
    ['Deployment', 'falcone-grafana'],
    ['StatefulSet', 'openbao'],
    ['Job', 'openbao-init'],
    ['Job', 'eso-preflight'],
    ['Job', 'eso-webhook-wait'],
    ['Job', 'openbao-tls-bootstrap'],
    ['Job', 'falcone-seaweedfs-tls-bootstrap'],
  ]) {
    const doc = findDoc(docs, kind, name);
    assert.ok(doc, `${kind}/${name} must render`);
    assert.ok(doc.spec.template.spec.imagePullSecrets?.some((secret) => secret.name === 'harbor-pull'), `${kind}/${name} must carry harbor-pull`);
  }
});

test('all-core-006d4: production SeaweedFS TLS render does not inline JWT signing keys', SKIP, () => {
  const docs = renderDocs(['-f', resolve(REPO_ROOT, '..', 'falcone-charts', 'deploy', 'kind', 'values-production.yaml')]);
  const seaweedSecurity = findDoc(docs, 'ConfigMap', 'falcone-seaweedfs-security-config');
  assert.ok(seaweedSecurity, 'production TLS render must include SeaweedFS security config');
  assert.doesNotMatch(seaweedSecurity.data?.['security.toml'] ?? '', /\[jwt\.signing\]|key = "[^"]+"/, 'production TLS render must not inline Helm-generated SeaweedFS JWT signing keys');
});

test('all-core-006d3: control plane wiring follows custom release and registry values', SKIP, () => {
  const result = spawnSync('helm', [
    'template', 'hawk', CHART_PATH, '--namespace', 'tenant-x',
    '--set', 'global.imageRegistry=registry.example.test/team',
  ], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 96 * 1024 * 1024 });
  assert.equal(result.status, 0, `custom release render must succeed\n${result.stderr}`);
  const parsed = parseAllDocuments(result.stdout);
  assert.deepEqual(parsed.flatMap((doc) => doc.errors), [], 'rendered YAML must not contain duplicate mapping keys');
  const docs = parsed.map((doc) => doc.toJSON()).filter(Boolean);
  const deployment = findDoc(docs, 'Deployment', 'hawk-control-plane');
  assert.ok(deployment, 'custom control-plane Deployment must render');
  const env = Object.fromEntries(deployment.spec.template.spec.containers[0].env.map((entry) => [entry.name, entry]));
  assert.equal(env.PGHOST.value, 'hawk-postgresql');
  assert.equal(env.PGUSER.valueFrom?.secretKeyRef?.key, 'POSTGRESQL_USERNAME');
  assert.equal(env.KEYCLOAK_BASE_URL.value, 'http://hawk-keycloak:8080');
  assert.equal(env.MONGO_HOST.value, 'hawk-ferretdb:27017');
  assert.equal(env.MONGO_BACKEND.value, 'ferretdb');
  assert.deepEqual(env.MONGO_USER.valueFrom?.secretKeyRef, { key: 'POSTGRES_USER', name: 'in-falcone-documentdb' });
  assert.deepEqual(env.MONGO_PASSWORD.valueFrom?.secretKeyRef, { key: 'POSTGRES_PASSWORD', name: 'in-falcone-documentdb' });
  assert.equal(findDoc(docs, 'Secret', 'in-falcone-documentdb'), undefined, 'custom render must not inline the documentdb credential Secret');
  const credentialHook = findDoc(docs, 'Job', 'hawk-in-falcone-credential-bootstrap');
  assert.ok(credentialHook, 'custom release must render the credential bootstrap hook');
  assert.match(commandText(credentialHook), /begin_secret in-falcone-documentdb documentdb/, 'credential hook must create the documentdb Secret referenced by control plane');
  const executor = findDoc(docs, 'Deployment', 'hawk-control-plane-executor');
  assert.ok(executor, 'custom control-plane executor Deployment must render');
  const executorEnv = Object.fromEntries(executor.spec.template.spec.containers[0].env.map((entry) => [entry.name, entry]));
  assert.equal(executorEnv.MONGO_HOST.value, 'hawk-ferretdb:27017');
  assert.equal(executorEnv.MONGO_BACKEND.value, 'ferretdb');
  assert.deepEqual(executorEnv.MONGO_USER.valueFrom?.secretKeyRef, { key: 'POSTGRES_USER', name: 'in-falcone-documentdb' });
  assert.deepEqual(executorEnv.MONGO_PASSWORD.valueFrom?.secretKeyRef, { key: 'POSTGRES_PASSWORD', name: 'in-falcone-documentdb' });
  assert.equal(env.STORAGE_S3_ENDPOINT.value, 'http://hawk-seaweedfs-s3:8333');
  assert.equal(env.STORAGE_S3_ACCESS_KEY.valueFrom?.secretKeyRef?.name, 'in-falcone-seaweedfs-s3-creds');
  assert.equal(env.KAFKA_BROKERS.value, 'hawk-kafka:9092');
  assert.equal(env.FN_RUNTIME_IMAGE.value, 'registry.example.test/team/gntik-ai/in-falcone-fn-runtime:0.3.0');
  const serializedEnv = JSON.stringify(deployment.spec.template.spec.containers[0].env);
  assert.doesNotMatch(serializedEnv, /localhost:30500|:0\.1\.0|falcone-storage|value\":\"falcone\"/);

  const openshiftDocs = renderDocs(['-f', OPENSHIFT_VALUES]);
  const openshiftControlPlane = findDoc(openshiftDocs, 'Deployment', 'falcone-control-plane');
  assert.equal(
    envValue(openshiftControlPlane, 'STORAGE_S3_ENDPOINT'),
    'https://falcone-seaweedfs-s3:8334',
    'OpenShift control plane must use the release-derived TLS SeaweedFS endpoint',
  );
  assert.equal(envValue(openshiftControlPlane, 'MONGO_HOST'), 'falcone-ferretdb:27017');
  assert.equal(envValue(openshiftControlPlane, 'MONGO_BACKEND'), 'ferretdb');
  const openshiftEnv = Object.fromEntries(openshiftControlPlane.spec.template.spec.containers[0].env.map((entry) => [entry.name, entry]));
  assert.deepEqual(openshiftEnv.MONGO_USER.valueFrom?.secretKeyRef, { key: 'POSTGRES_USER', name: 'in-falcone-documentdb' });
  assert.deepEqual(openshiftEnv.MONGO_PASSWORD.valueFrom?.secretKeyRef, { key: 'POSTGRES_PASSWORD', name: 'in-falcone-documentdb' });
  const openshiftExecutor = findDoc(openshiftDocs, 'Deployment', 'falcone-control-plane-executor');
  assert.equal(envValue(openshiftExecutor, 'MONGO_HOST'), 'falcone-ferretdb:27017');
  assert.equal(envValue(openshiftExecutor, 'MONGO_BACKEND'), 'ferretdb');
});

test('all-core-006e: OpenShift Harbor documentation mirrors stay synchronized', () => {
  const installation = readFileSync(resolve(REPO_ROOT, 'docs', 'installation', 'openshift-airgapped-harbor.md'), 'utf8');
  const site = readFileSync(resolve(REPO_ROOT, 'docs-site', 'operations', 'openshift-airgapped-harbor.md'), 'utf8');
  assert.equal(site, installation, 'docs-site OpenShift Harbor guide must mirror docs/installation');
  assert.match(site, /^# Legacy 0\.3\.0 OpenShift\/Harbor Plain-Manifest Reference/m);
  assert.match(site, /Unsupported for new C-25\/chart 0\.3\.1 installs and upgrades/);
  assert.match(site, /omit the mandatory chart-managed webhook signing-key Secret reference,\s+> credential\/lifecycle Jobs, and lifecycle RBAC/);
  assert.match(site, /Copying only a newer\s+> control-plane or other image into these manifests is unsafe and unsupported/);
  assert.match(site, /\[matched Helm chart\]\(\/operations\/helm-configuration\)/);
  assert.match(site, /\[OpenShift Install guide\]\(\/operations\/openshift-install\)/);
  assert.match(site, /\[Webhook Signing-Key Lifecycle runbook\]\(\/operations\/webhook-signing-key-lifecycle\)/);
  assert.match(site, /Existing\s+> `0\.3\.0` manual installations must remain pinned to `0\.3\.0` and continue their existing manual\s+> process until a separate manual-to-Helm migration is approved and safely rehearsed/);
  assert.match(site, /No supported\s+> resource-import path moves these plain-manifest resources into Helm/);
  assert.match(site, /webhook key adoption does not\s+> import or transfer ownership of them/);
});

test('all-core-006f: docs do not advertise the legacy no-Helm reference as a C-25 install choice', () => {
  const advertisements = [
    'docs-site/guide/installation.md',
    'docs-site/personas/operator.md',
    'docs-site/operations/helm-configuration.md',
    'docs-site/operations/openshift-install.md',
    'docs-site/operations/webhook-signing-key-lifecycle.md',
  ];
  for (const rel of advertisements) {
    const text = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
    assert.match(
      text,
      /legacy\s+`?0\.3\.0`?|frozen\s+`0\.3\.0`/i,
      `${rel} must label the manual guide as legacy 0.3.0`,
    );
    assert.match(
      text,
      /not\s+a\s+supported|unsupported\s+for/i,
      `${rel} must reject the manual guide as a C-25 install/upgrade choice`,
    );
    assert.match(
      text,
      /unsafe and unsupported/,
      `${rel} must warn against copying only a newer image into the legacy manifests`,
    );
    assert.match(
      text,
      /manual (?:`0\.3\.0` (?:OpenShift )?installations?|OpenShift installation on legacy\s+`0\.3\.0`)[\s\S]{0,300}?must\s+remain pinned to\s+`0\.3\.0`/i,
      `${rel} must keep existing manual installations pinned`,
    );
    assert.match(
      text,
      /manual-to-Helm migration\s+is\s+approved\s+and\s+(?:safely\s+)?rehearsed/i,
      `${rel} must require an approved and rehearsed manual-to-Helm migration`,
    );
  }

  const sidebar = readFileSync(resolve(REPO_ROOT, 'docs-site', '.vitepress', 'config.mts'), 'utf8');
  assert.match(
    sidebar,
    /Legacy 0\.3\.0 Manual \(Unsupported\).*\/operations\/openshift-airgapped-harbor/,
    'the operations sidebar must label the no-Helm page as a legacy unsupported reference',
  );
});

test('all-core-006j: C-25 runbook includes literal handoff, restore, and secret-safe dry-run gates', () => {
  const runbook = readFileSync(
    resolve(REPO_ROOT, 'docs-site', 'operations', 'webhook-signing-key-lifecycle.md'),
    'utf8',
  );

  assert.match(runbook, /Release status: draft, unpublished, and partially live-verified/);
  assert.match(runbook, /Helm revision 16/);
  assert.match(
    runbook,
    /ghcr\.io\/gntik-ai\/in-falcone-control-plane@sha256:27aedbfabdc8b72baae844b14dbdf72820c0f4d548a49013118d9ba7e0588d40/,
  );
  assert.match(runbook, /FALCONE_EXPECTED_CHART_SHA/);
  assert.match(runbook, /FALCONE_EXPECTED_CONTROL_PLANE_IMAGE/);
  assert.match(
    runbook,
    /test "\$\(realpath -- "\$FALCONE_CHART"\)" = \\\n  "\$\(realpath -- "\$FALCONE_CHART_SOURCE\/charts\/in-falcone"\)"/,
  );
  assert.match(runbook, /test "\$FALCONE_SELECTED_CONTROL_PLANE_IMAGE" =/);

  assert.match(runbook, /expected_first_handoff="\$2"/);
  assert.match(runbook, /validate_webhook_lifecycle_upgrade '0\.3\.0' true/);
  assert.match(runbook, /validate_webhook_lifecycle_upgrade '0\.3\.1' false/);
  assert.match(runbook, /migration\.firstHandoff=\$\{expected_first_handoff\}/);
  assert.match(runbook, /migration\.backupVerified=true/);
  assert.match(runbook, /migration\.parityVerified=true/);
  assert.match(runbook, /migration\.backupReference=\$\{FALCONE_BACKUP_REFERENCE\}/);
  assert.match(runbook, /--dry-run=server --hide-secret >\/dev\/null/);
  assert.match(runbook, /Do not change the adoption request ID for that replay/);
  assert.match(runbook, /WEBHOOK-DATABASE-AUTHORITY\.md/);

  assert.match(runbook, /Rehearse the bundled backup on matching PostgreSQL 17\.2/);
  assert.match(
    runbook,
    /docker\.io\/library\/postgres:17\.2-alpine@sha256:7e5df973a74872482e320dcbdeb055e178d6f42de0558b083892c50cda833c96/,
  );
  assert.match(runbook, /pg_restore --list \/tmp\/falcone-backup\.dump/);
  assert.doesNotMatch(runbook, /pg_restore --list "\$FALCONE_DB_BACKUP"/);
  assert.match(runbook, /never rehearse a PostgreSQL 17 archive with PostgreSQL 16 tooling/);
  assert.match(runbook, /--network none/);
  assert.match(runbook, /test "\$FALCONE_SOURCE_INVENTORY" = "\$FALCONE_RESTORE_INVENTORY"/);
  assert.match(runbook, /trap cleanup_webhook_restore EXIT HUP INT TERM/);
  assert.match(runbook, /Rehearse matching-key startup and readiness on the restored copy/);
  assert.match(runbook, /FALCONE_RESTORE_EXPECTED_SOURCE_CHART_SHA/);
  assert.match(
    runbook,
    /git -C "\$FALCONE_RESTORE_SOURCE_CHART_SOURCE" rev-parse HEAD/,
  );
  assert.match(
    runbook,
    /realpath -- "\$FALCONE_RESTORE_SOURCE_CHART_SOURCE\/charts\/in-falcone"/,
  );
  assert.match(runbook, /install "\$FALCONE_RESTORE_RELEASE" "\$FALCONE_RESTORE_SOURCE_CHART"/);
  assert.match(runbook, /cat > \/tmp\/falcone-restore\.dump/);
  assert.match(runbook, /--owner="\$POSTGRESQL_USERNAME" falcone_restore/);
  assert.match(runbook, /--dbname=falcone_restore/);
  assert.match(
    runbook,
    /test "\$FALCONE_SOURCE_INVENTORY" = "\$FALCONE_RESTORED_CLUSTER_INVENTORY"/,
  );
  assert.match(runbook, /global\.webhookDatabase\.connection\.host=/);
  assert.match(runbook, /global\.webhookDatabase\.connection\.database=/);
  assert.match(runbook, /readinessProbe\.httpGet\.path/);
  assert.match(runbook, /services\/http:\$\{FALCONE_RESTORE_RELEASE\}-control-plane:http\/proxy\/readyz/);
  assert.match(runbook, /FALCONE_RESTORE_STATUS/);
  assert.match(runbook, /\.affectedCount == \.verifiedCount/);
  assert.match(runbook, /FALCONE_RESTORE_TENANT_A_CURL_CONFIG/);
  assert.match(runbook, /FALCONE_RESTORE_TENANT_B_CURL_CONFIG/);
  assert.match(runbook, /FALCONE_RESTORE_CROSS_SCOPE_STATUS/);
  assert.match(runbook, /tenant\/public parity verified: ownRoutes=2/);
  assert.match(runbook, /test "\$FALCONE_RESTORE_PARITY_VERIFIED" = 'true'/);
  assert.match(runbook, /cleanup_webhook_kube_restore/);
  assert.match(runbook, /delete namespace "\$FALCONE_RESTORE_NAMESPACE" --wait/);
});

test('all-core-006i: E2E Helm overlays render without obsolete service lifecycle toggles', SKIP, () => {
  const forbiddenLifecycleAliases = [
    'bootstrap',
    'apisix',
    'mongodb',
    'openwhisk',
    'storage',
    'observability',
    'eso',
    'openbao',
    'controlPlane',
    'controlPlaneExecutor',
    'workflowWorker',
    'temporal',
    'postgresql',
    'webConsole',
    'keycloak',
    'kafka',
    'documentdb',
    'ferretdb',
    'seaweedfs',
  ];
  for (const valuesPath of [E2E_FLOWS_VALUES, E2E_FERRETDB_VALUES]) {
    const values = parseValuesFile(valuesPath);
    for (const alias of forbiddenLifecycleAliases) {
      assert.notEqual(
        typeof values[alias]?.enabled,
        'boolean',
        `${valuesPath} must not set obsolete top-level ${alias}.enabled`,
      );
    }
  }

  assertRender(['--skip-schema-validation', '-f', E2E_FLOWS_VALUES]);
  assertRender(['--skip-schema-validation', '-f', E2E_FERRETDB_VALUES]);
  assertRender(['--skip-schema-validation', '-f', KIND_VALUES, '-f', E2E_FERRETDB_VALUES]);
});

test('all-core-008: ESO cluster-scoped ownership preflight renders', SKIP, () => {
  const out = assertRender();
  const docs = parseAllDocuments(out).map((doc) => doc.toJSON()).filter(Boolean);
  const esoPreflight = findDoc(docs, 'Job', 'eso-preflight');
  const preflightScript = commandText(esoPreflight);
  assert.match(out, /kind:\s*Job[\s\S]*name:\s*eso-preflight/, 'ESO ownership preflight Job must render');
  assert.match(out, /resources:\s*\["clustersecretstores"\]/, 'preflight must inspect ClusterSecretStore ownership');
  assert.match(out, /resources:\s*\["deployments"\]/, 'preflight must inspect cluster ESO deployments');
  assert.match(out, /adoptExisting/, 'preflight must expose the explicit adoptExisting override');
  assert.match(preflightScript, /meta\.helm\.sh\/release-name/, 'preflight must check Helm release-name ownership');
  assert.match(preflightScript, /meta\.helm\.sh\/release-namespace/, 'preflight must check Helm release-namespace ownership');
  assert.match(preflightScript, /app\.kubernetes\.io\/part-of"\] == "in-falcone"/, 'preflight must require Falcone ownership labels on ClusterSecretStore');
  assert.match(preflightScript, /startswith\("https:\/\/openbao\." \+ \$openbao_namespace \+ "\.svc"\)/, 'preflight must verify the ClusterSecretStore points at the configured OpenBao namespace');
  assert.match(preflightScript, /external-secrets controller is not owned by \$\{release\}\/\$\{namespace\}/, 'preflight must reject same-namespace ESO deployments without Helm ownership');
  assert.doesNotMatch(preflightScript, /\$\{eso_namespace\}\/\*\) ;;/, 'preflight must not whitelist ESO controllers by namespace alone');
  assert.match(out, /set eso\.eso\.clusterOwnership\.adoptExisting=true/, 'preflight must fail closed on unowned cluster-scoped stores');
});

test('all-core-009: OpenBao, ESO, and runtime env honor custom secret namespaces', SKIP, () => {
  const out = assertRender([
    '--set', 'eso.eso.namespace=custom-eso',
    '--set', 'eso.external-secrets.namespaceOverride=custom-eso',
    '--set', 'openbao.eso.namespace=custom-eso',
    '--set', 'openbao.openbao.namespace=custom-store',
    '--set', 'eso.eso.caProvider.namespace=custom-store',
  ]);
  const docs = parseAllDocuments(out).map((doc) => doc.toJSON()).filter(Boolean);
  assert.match(out, /name:\s*eso-openbao-auth[\s\S]*namespace:\s*custom-eso/, 'OpenBao must render ESO auth ServiceAccount in the configured ESO namespace');
  assert.match(out, /bound_service_account_namespaces='custom-eso'/, 'OpenBao Kubernetes auth role for ESO must bind the configured ESO namespace');
  assert.match(out, /BAO_ADDR:\s*"https:\/\/openbao\.custom-store\.svc\.cluster\.local:8200"/, 'runtime env must point workloads at the configured OpenBao namespace');
  assert.match(out, /api_addr\s*=\s*"https:\/\/openbao\.custom-store\.svc\.cluster\.local:8200"/, 'OpenBao api_addr must use the configured OpenBao namespace');
  assert.match(out, /cluster_addr\s*=\s*"https:\/\/\$\(HOSTNAME\)\.openbao-internal\.custom-store\.svc\.cluster\.local:8201"/, 'OpenBao cluster_addr must use the configured OpenBao namespace');
  assert.match(out, /server:\s*"https:\/\/openbao\.custom-store\.svc\.cluster\.local:8200"/, 'ESO ClusterSecretStore must use the configured OpenBao namespace');
  assert.match(out, /kubernetes\.io\/metadata\.name:\s*custom-eso/, 'OpenBao NetworkPolicy must allow the configured ESO namespace');
  assert.match(out, /kubernetes\.io\/metadata\.name:\s*"custom-store"/, 'ESO NetworkPolicy must allow egress to the configured OpenBao namespace');
  assert.equal(findDoc(docs, 'Deployment', 'eso-external-secrets')?.metadata?.namespace, 'custom-eso', 'ESO controller must run in the configured ESO namespace');
  assert.doesNotMatch(out, /bound_service_account_namespaces='eso-system'/, 'custom ESO namespace must not leave the auth role hard-coded to eso-system');
  assert.doesNotMatch(out, /https:\/\/openbao\.secret-store\.svc\.cluster\.local:8200/, 'custom OpenBao namespace must not leave workload or ESO addresses hard-coded to secret-store');
});

test('all-core-009d: pre-install hooks run in the release namespace while targeting configured auxiliary namespaces', SKIP, () => {
  const docs = renderDocs([
    '--set', 'seaweedfsTls.bootstrap.enabled=true',
    '--set', 'eso.eso.namespace=custom-eso',
    '--set', 'eso.external-secrets.namespaceOverride=custom-eso',
    '--set', 'openbao.eso.namespace=custom-eso',
    '--set', 'openbao.openbao.namespace=custom-store',
    '--set', 'eso.eso.caProvider.namespace=custom-store',
  ]);
  for (const doc of hookKinds(docs, ['pre-install', 'pre-upgrade'])) {
    if (doc.kind === 'ClusterRole' || doc.kind === 'ClusterRoleBinding') continue;
    assert.equal(doc.metadata?.namespace, 'review-ns', `${doc.kind}/${doc.metadata?.name} pre-install hook must run in the release namespace`);
  }

  const openbaoTls = findDoc(docs, 'Job', 'openbao-tls-bootstrap');
  assert.ok(openbaoTls, 'OpenBao TLS bootstrap Job must render');
  assert.equal(openbaoTls.metadata?.namespace, 'review-ns', 'OpenBao TLS bootstrap Job must run in the release namespace');
  assert.equal(envValue(openbaoTls, 'NS'), 'custom-store', 'OpenBao TLS bootstrap must still write the server cert into the configured OpenBao namespace');
  assert.equal(envValue(openbaoTls, 'CLIENT_NS'), 'review-ns', 'OpenBao client CA copy must target the release namespace');
  assert.match(commandText(openbaoTls), /ensure_namespace "\$NS"/, 'OpenBao TLS bootstrap must create/adopt the configured target namespace before writing the TLS secret');

  const esoPreflight = findDoc(docs, 'Job', 'eso-preflight');
  assert.ok(esoPreflight, 'ESO ownership preflight Job must render');
  assert.equal(esoPreflight.metadata?.namespace, 'review-ns', 'ESO preflight Job must run in the release namespace');
  assert.match(commandText(esoPreflight), /eso_namespace="custom-eso"/, 'ESO preflight must still evaluate the configured ESO operator namespace');

  const temporalDb = findDoc(docs, 'Job', 'falcone-temporal-db-bootstrap');
  const temporalSchema = findDoc(docs, 'Job', 'falcone-temporal-schema');
  assert.equal(temporalDb?.metadata?.namespace, 'review-ns', 'Temporal DB bootstrap install Job must run in the release namespace');
  assert.equal(temporalSchema?.metadata?.namespace, 'review-ns', 'Temporal schema install Job must run in the release namespace');

  const seaweedResizeHook = readFileSync(resolve(CHART_PATH, 'charts', 'seaweedfs', 'templates', 'volume', 'volume-resize-hook.yaml'), 'utf8');
  const seaweedValues = readFileSync(resolve(CHART_PATH, 'charts', 'seaweedfs', 'values.yaml'), 'utf8');
  assert.match(seaweedResizeHook, /volume-resize-hook[\s\S]*namespace: \{\{ \.Release\.Namespace \}\}/, 'SeaweedFS resize hook resources must explicitly run in the release namespace when the live-state condition renders them');
  assert.match(seaweedResizeHook, /subjects:[\s\S]*namespace: \{\{ \.Release\.Namespace \}\}/, 'SeaweedFS resize hook RoleBinding subject must use the release namespace');
  assert.match(seaweedValues, /resizeHook:[\s\S]*image: docker\.io\/alpine\/k8s:1\.32\.2/, 'SeaweedFS resize hook must use the verified alpine/k8s helper image');
});

test('all-core-009b: mismatched ESO operator namespace fails closed', SKIP, () => {
  const r = helmTemplate([
    '--set', 'eso.eso.namespace=custom-eso',
    '--set', 'openbao.eso.namespace=custom-eso',
  ]);
  assert.notEqual(r.status, 0, 'custom ESO auth namespace without matching operator namespace override must fail');
  assert.match(r.stderr, /namespaceOverride must match eso\.eso\.namespace/, 'validation must explain the protected ESO namespace contract');
});

test('all-core-009c: cert-manager OpenBao certificate SANs honor custom namespace', SKIP, () => {
  const args = [
    '--set', 'openbao.openbao.tls.mode=cert-manager',
    '--set', 'eso.eso.namespace=custom-eso',
    '--set', 'eso.external-secrets.namespaceOverride=custom-eso',
    '--set', 'openbao.eso.namespace=custom-eso',
    '--set', 'openbao.openbao.namespace=custom-store',
    '--set', 'eso.eso.caProvider.namespace=custom-store',
  ];
  const out = assertRender(args);
  assert.match(out, /kind:\s*Certificate\s+metadata:\s*\n\s*name:\s*openbao-server-tls\s*\n\s*namespace:\s*custom-store[\s\S]*?spec:\s*\n\s*secretName:\s*openbao-server-tls/, 'OpenBao server Certificate must render in the configured OpenBao namespace');
  assert.match(out, /kind:\s*Certificate\s+metadata:\s*\n\s*name:\s*in-falcone-openbao-client-ca\s*\n\s*namespace:\s*review-ns[\s\S]*?spec:\s*\n\s*secretName:\s*in-falcone-openbao-client-ca/, 'cert-manager mode must create the client CA Secret mounted by runtimes in the release namespace');
  assert.match(out, /commonName:\s*openbao\.custom-store\.svc\.cluster\.local/, 'OpenBao Certificate commonName must use the configured namespace');
  assert.match(out, /dnsNames:[\s\S]*openbao\.custom-store[\s\S]*openbao\.custom-store\.svc[\s\S]*openbao\.custom-store\.svc\.cluster\.local[\s\S]*openbao-internal\.custom-store\.svc\.cluster\.local/, 'OpenBao Certificate SANs must use the configured namespace');
  assert.doesNotMatch(out, /openbao\.secret-store\.svc\.cluster\.local/, 'custom cert-manager SANs must not retain secret-store');
});

test('all-core-010: Kafka default and supported profiles are valid single-broker KRaft', SKIP, () => {
  for (const args of [
    [],
    ['-f', resolve(REPO_ROOT, '..', 'falcone-charts', 'charts', 'in-falcone', 'values', 'profiles', 'standard.yaml')],
    ['-f', resolve(REPO_ROOT, '..', 'falcone-charts', 'charts', 'in-falcone', 'values', 'profiles', 'ha.yaml')],
  ]) {
    const docs = renderDocs(args);
    const kafka = findDoc(docs, 'StatefulSet', 'falcone-kafka');
    assert.ok(kafka, 'Kafka StatefulSet must render');
    assert.equal(kafka.spec?.replicas, 1, `Kafka must default to one broker for args ${args.join(' ') || '(base)'}`);
  }
  const credentialHook = findDoc(renderDocs(), 'Job', 'falcone-in-falcone-credential-bootstrap');
  assert.ok(credentialHook, 'credential bootstrap hook must render');
  const credentialScript = commandText(credentialHook);
  assert.match(credentialScript, /begin_secret in-falcone-kafka kafka/, 'Kafka Secret must be created by the credential hook');
  assert.match(credentialScript, /KAFKA_CFG_NODE_ID 0/, 'Kafka Secret must seed node id 0 for the single broker');
  assert.match(credentialScript, /KAFKA_CFG_CONTROLLER_QUORUM_VOTERS 0@127\.0\.0\.1:9093/, 'single-broker KRaft quorum must use node 0 only');
});

test('all-core-011: existing-install cutover scripts fail closed, merge KV data, and are release-name safe', () => {
  const common = readFileSync(resolve(CUTOVER_SCRIPTS, 'common.sh'), 'utf8');
  const backup = readFileSync(resolve(CUTOVER_SCRIPTS, 'backup-kv.sh'), 'utf8');
  const migrate = readFileSync(resolve(CUTOVER_SCRIPTS, 'migrate-platform-secrets.sh'), 'utf8');
  const restore = readFileSync(resolve(CUTOVER_SCRIPTS, 'restore-kv.sh'), 'utf8');
  const health = readFileSync(resolve(CUTOVER_SCRIPTS, 'health-check.sh'), 'utf8');
  const diff = readFileSync(resolve(CUTOVER_SCRIPTS, 'diff-rollout.sh'), 'utf8');
  const openbaoInit = readFileSync(resolve(REPO_ROOT, '..', 'falcone-charts', 'charts', 'in-falcone', 'charts', 'openbao', 'templates', 'openbao-init-job.yaml'), 'utf8');

  assert.match(backup, /helm -n "\$NS" get values "\$RELEASE" --all -o yaml/, 'backup must capture Helm values for the configured release');
  assert.match(backup, /write_secret_checksums/, 'backup must capture Kubernetes Secret fingerprints');
  assert.match(backup, /backup_source_kv_paths/, 'backup must support external Vault\/OpenBao source KV capture');
  assert.match(backup, /refusing to overwrite existing backup archive/, 'backup must refuse to overwrite an existing archive');
  assert.match(backup, /target OpenBao not supplied; recording target KV as absent/, 'backup must work before target OpenBao exists');
  assert.match(backup, /"targetKvCaptured":\$target_kv_captured/, 'backup manifest must record whether target KV was captured');

  assert.match(common, /cp "\$existing" "\$merged"/, 'KV helper must start from existing target data');
  assert.match(common, /jq --arg property "\$property" --rawfile value "\$file" '\. \+ \{\(\$property\): \$value\}'/, 'KV helper must overlay mapped properties without dropping unmapped ones');
  assert.match(common, /kv2_export_tree/, 'common helpers must recursively export KV-v2 trees');
  assert.match(common, /merge_kv_tree_into_target/, 'common helpers must merge backed-up external source KV trees');
  assert.match(common, /restore_kv_tree_exact/, 'common helpers must restore the captured target KV tree exactly');
  assert.match(common, /write_kv_json_exact/, 'common helpers must write backup JSON without preserving post-backup properties');
  assert.match(common, /capture_optional_kubectl_json/, 'Kubernetes capture helpers must separate optional explicit NotFound from other kubectl failures');
  assert.match(common, /refusing to record resource as absent/, 'Kubernetes capture helpers must fail closed on kubectl errors');
  assert.match(common, /reason:"NotFound"/, 'optional absent Kubernetes resources must record an explicit NotFound reason');
  assert.match(openbaoInit, /kv_merge\(\)[\s\S]*bao kv get "\$path"[\s\S]*bao kv patch "\$path"[\s\S]*bao kv put "\$path"/, 'OpenBao init must patch existing KV paths and only put on first creation');

  assert.match(migrate, /--apply requires --backup/, 'migration apply must require a verified backup');
  assert.match(common, /require_test_cluster_write_guard\(\)/, 'common helpers must define the explicit test-cluster write guard');
  assert.match(common, /TEST_CLUSTER_CONTEXT/, 'write guard must require an explicit target context');
  assert.match(common, /kubectl config current-context/, 'write guard must compare the active kubectl context exactly');
  assert.match(common, /CONFIRM_TEST_CLUSTER[\s\S]*phrase="apply-to-explicit-test-cluster"/, 'write guard must require the unambiguous confirmation phrase');
  assert.match(migrate, /require_test_cluster_write_guard[\s\S]*assert_backup_covers_current_mappings/, 'migration apply must pass the test-cluster guard before OpenBao writes');
  assert.match(migrate, /CONFIRM_SECRET_OVERWRITE=overwrite-existing-openbao-values/, 'migration overwrite mode must require an explicit guard');
  assert.match(migrate, /require_backup_captured_target_kv_for_overwrite/, 'migration overwrite mode must require targetKvCaptured=true in the verified backup');
  assert.match(migrate, /refusing to overwrite/, 'migration must fail closed on destination mismatch');
  assert.match(migrate, /diff summary: match=\$matches missing=\$missing mismatch=\$mismatches/, 'migration dry-run must report a real destination diff');
  assert.match(migrate, /merge_source_backup_into_target/, 'migration must deliberately merge backed-up external source KV before applying mapped overlays');
  assert.match(migrate, /merge_kv_tree_into_target/, 'migration must import the full external source KV tree, not only mapped platform paths');

  assert.match(restore, /helm -n "\$NS" rollback "\$RELEASE" "\$revision"/, 'restore must provide executable Helm rollback for the configured release');
  assert.match(restore, /kubectl -n "\$NS" apply -f "\$backup_dir\/kubernetes\/secrets\.apply\.json"/, 'restore must restore Kubernetes Secrets from the backup');
  assert.match(restore, /restore_kv_tree_exact/, 'restore must restore the captured target OpenBao KV tree exactly');
  assert.match(restore, /restore_target_kv_tree_if_available/, 'restore must make target OpenBao KV recovery conditional after Kubernetes and Helm recovery');
  assert.doesNotMatch(restore, /require_bao/, 'restore must not require target OpenBao before Kubernetes Secret, ESO, or Helm rollback recovery');
  assert.match(restore, /\[ "\$MODE" = "--apply" \][\s\S]*require_test_cluster_write_guard/, 'restore apply/helm rollback path must pass the test-cluster guard before writes');

  assert.match(health, /kubectl get clustersecretstore openbao-backend -o json > "\$cluster_store_json"/, 'health check must inspect the exact ClusterSecretStore object');
  assert.match(health, /verify_scoped_clustersecretstores "\$cluster_store_json"/, 'health check must reject ClusterSecretStore ownership or OpenBao namespace drift');
  assert.match(health, /app\.kubernetes\.io\/instance=\$RELEASE/, 'health check must select workloads by release label');
  assert.doesNotMatch(health, /deploy\/falcone-|statefulset\/falcone-/, 'health check must not hard-code the falcone release name');

  assert.match(diff, /helm diff upgrade --install "\$RELEASE" "\$CHART" -n "\$NS"/, 'diff gate must use helm diff when available');
  assert.match(diff, /helm template "\$RELEASE" "\$CHART" -n "\$NS"/, 'diff gate must render manifests as a fallback');
  assert.match(diff, /kubectl -n "\$NS" diff -f "\$tmp\/rendered\.yaml"/, 'diff gate fallback must use read-only kubectl diff');
  assert.equal((statSync(resolve(CUTOVER_SCRIPTS, 'diff-rollout.sh')).mode & 0o111) !== 0, true, 'diff gate must be executable');
});

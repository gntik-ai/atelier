/**
 * Black-box test suite for spec change add-flows-dsl-interpreter-worker.
 *
 * Drives the PUBLIC surface of the workflow-worker service ONLY — no live Temporal
 * server is required here (live-Temporal behaviours: durable resume, version pinning,
 * replay, node-ID-from-history — live in tests/env/workflow-worker/*.test.mjs).
 *
 * Public surface asserted here:
 *   - the service package manifest (Temporal SDK deps, CJS deviation documented)
 *   - the workflow / interpreter source module shape (exported DslInterpreterWorkflow,
 *     node-ID naming convention helper, deterministic-only code)
 *   - the activity-interface contract (input envelope shape downstream #360 plugs into)
 *   - the Dockerfile (node:22-slim base — @temporalio/core-bridge ships a glibc native binary that cannot load on Alpine/musl — USER node, build-from-root)
 *   - the umbrella helm chart renders the core worker Deployment (flows-worker label, non-root,
 *     probes) by default
 *
 * Tests that shell out to `helm` self-skip when the binary is absent (repo precedent:
 * tests/blackbox/flows-temporal-helm.test.mjs).
 *
 * Scenario coverage (capability: workflows / spec.md):
 *   bbx-flows-interp-001  service package: Temporal SDK deps + NOT "type":"module"
 *   bbx-flows-interp-002  TS convention deviation is documented (note in package / README)
 *   bbx-flows-interp-003  DslInterpreterWorkflow is exported from the workflows module
 *   bbx-flows-interp-004  node-ID activity naming convention is exposed + documented
 *   bbx-flows-interp-005  workflow code uses no non-deterministic host API (Date.now/Math.random/fetch)
 *   bbx-flows-interp-006  activity-interface contract envelope shape is exported + documented
 *   bbx-flows-interp-007  Dockerfile: node:22-slim base (glibc for core-bridge), USER node, build from repo root
 *   bbx-flows-interp-008  helm: default core install renders the worker Deployment
 *   bbx-flows-interp-009  helm: worker Deployment carries the flows-worker label
 *   bbx-flows-interp-010  helm: worker pod spec is non-root with liveness+readiness probes
 *   bbx-flows-interp-011  helm: values.schema.json accepts workflowWorker (lint/template exit 0)
 *   bbx-flows-interp-012  retry-policy + duration mapping helpers exposed per the normative contract
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const SVC = resolve(REPO_ROOT, 'services', 'workflow-worker');
const CHART_PATH = resolve(REPO_ROOT, '..', 'falcone-charts', 'charts', 'in-falcone');

function read(p) {
  return readFileSync(p, 'utf8');
}

function helmAvailable() {
  const r = spawnSync('helm', ['version', '--short'], { encoding: 'utf8' });
  return r.status === 0;
}
const HELM = helmAvailable();
const SKIP = HELM ? false : { skip: 'helm binary not available on PATH' };

function helmTemplate(extraArgs = []) {
  return spawnSync('helm', ['template', 'falcone', CHART_PATH, ...extraArgs], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function helmLint(extraArgs = []) {
  return spawnSync('helm', ['lint', CHART_PATH, ...extraArgs], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    maxBuffer: 32 * 1024 * 1024,
  });
}

function splitDocs(stream) {
  return String(stream || '')
    .split(/^---\s*$/m)
    .map((d) => d.trim())
    .filter((d) => d.length > 0 && /(^|\n)kind:\s*\S/.test(d));
}
function docKind(doc) {
  const m = doc.match(/(?:^|\n)kind:\s*(\S+)/);
  return m ? m[1] : '';
}
function docName(doc) {
  const m = doc.match(/(?:^|\n)metadata:\s*\n(?:\s+\S.*\n)*?\s+name:\s*(\S+)/);
  if (m) return m[1];
  const m2 = doc.match(/(?:^|\n)\s+name:\s*(\S+)/);
  return m2 ? m2[1] : '';
}

// ---------------------------------------------------------------------------
// bbx-flows-interp-001: service package manifest
// ---------------------------------------------------------------------------
test('bbx-flows-interp-001: package.json declares Temporal SDK deps and is NOT type:module', () => {
  const pkgPath = resolve(SVC, 'package.json');
  assert.ok(existsSync(pkgPath), 'apps/workflow-worker/package.json must exist');
  const pkg = JSON.parse(read(pkgPath));
  for (const dep of ['@temporalio/worker', '@temporalio/workflow', '@temporalio/activity', '@temporalio/client']) {
    assert.ok(pkg.dependencies?.[dep], `package.json must depend on ${dep}`);
  }
  assert.notEqual(pkg.type, 'module', 'package.json must NOT declare "type":"module" (Temporal bundler needs CJS)');
  assert.ok(pkg.scripts?.build, 'package.json must expose a build script (tsc compile)');
});

// ---------------------------------------------------------------------------
// bbx-flows-interp-002: TS/CJS deviation documented
// ---------------------------------------------------------------------------
test('bbx-flows-interp-002: TypeScript/CommonJS convention deviation is documented', () => {
  const readmePath = resolve(SVC, 'README.md');
  const pkgPath = resolve(SVC, 'package.json');
  const haystacks = [];
  if (existsSync(readmePath)) haystacks.push(read(readmePath));
  if (existsSync(pkgPath)) haystacks.push(read(pkgPath));
  const blob = haystacks.join('\n');
  assert.match(
    blob,
    /CommonJS|CJS|bundler|deterministic bundler|type.*module/i,
    'the CJS-over-ESM deviation must be documented in README.md or package.json',
  );
  assert.match(blob, /Temporal/i, 'the deviation note must reference the Temporal SDK constraint');
});

// ---------------------------------------------------------------------------
// bbx-flows-interp-003: DslInterpreterWorkflow exported
// ---------------------------------------------------------------------------
test('bbx-flows-interp-003: DslInterpreterWorkflow is exported from the workflows module', () => {
  const wf = resolve(SVC, 'src', 'workflows', 'DslInterpreterWorkflow.ts');
  assert.ok(existsSync(wf), 'src/workflows/DslInterpreterWorkflow.ts must exist');
  const src = read(wf);
  assert.match(src, /export\s+async\s+function\s+DslInterpreterWorkflow\b/, 'must export async function DslInterpreterWorkflow');
});

// ---------------------------------------------------------------------------
// bbx-flows-interp-004: node-ID activity naming convention exposed + documented
// ---------------------------------------------------------------------------
test('bbx-flows-interp-004: node-ID activity naming convention is exposed and documented', () => {
  const wf = resolve(SVC, 'src', 'workflows', 'DslInterpreterWorkflow.ts');
  const src = read(wf);
  // Normative contract (design.md D3): activityId === DSL node id on every executeActivity.
  assert.match(src, /activityId/, 'workflow must pass an activityId on activity dispatch (node-ID naming convention)');
  assert.match(src, /node\.id/, 'the activityId must be derived from the DSL node id');

  // The convention is documented in the package surface (README or a NAMING constant comment).
  const readmePath = resolve(SVC, 'README.md');
  const conventionPath = resolve(SVC, 'src', 'shared', 'naming.ts');
  const docBlob = [
    existsSync(readmePath) ? read(readmePath) : '',
    existsSync(conventionPath) ? read(conventionPath) : '',
    src,
  ].join('\n');
  assert.match(
    docBlob,
    /activityId/,
    'the node-ID naming convention must be documented in README.md or src/shared/naming.ts',
  );
});

// ---------------------------------------------------------------------------
// bbx-flows-interp-005: no non-deterministic host API in workflow code
// ---------------------------------------------------------------------------
test('bbx-flows-interp-005: workflow code uses no non-deterministic host API', () => {
  const wf = resolve(SVC, 'src', 'workflows', 'DslInterpreterWorkflow.ts');
  const src = read(wf);
  // Strip line + block comments so documentation mentioning these APIs does not trip the guard.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
  for (const banned of [/\bDate\.now\s*\(/, /\bMath\.random\s*\(/, /\bfetch\s*\(/, /\brequire\(['"]http['"]\)/, /new\s+Date\s*\(\s*\)/]) {
    assert.doesNotMatch(code, banned, `workflow code must not use non-deterministic API ${banned}`);
  }
});

// ---------------------------------------------------------------------------
// bbx-flows-interp-006: activity-interface contract envelope exported + documented
// ---------------------------------------------------------------------------
test('bbx-flows-interp-006: activity-interface contract envelope is exported and documented', () => {
  const types = resolve(SVC, 'src', 'shared', 'types.ts');
  assert.ok(existsSync(types), 'src/shared/types.ts must exist (the #360 plug-in contract)');
  const src = read(types);
  // The activity input envelope: node, resolved params, tenant context (design.md).
  assert.match(src, /ActivityInput|ExecuteTaskInput|TaskActivityInput/, 'an activity input envelope type must be exported');
  assert.match(src, /tenant/i, 'the activity input envelope must carry a tenant context field');
  assert.match(src, /node/i, 'the activity input envelope must carry the originating node');
});

// ---------------------------------------------------------------------------
// bbx-flows-interp-007: Dockerfile properties
// ---------------------------------------------------------------------------
test('bbx-flows-interp-007: Dockerfile uses node:22-slim, a numeric non-root UID, builds from repo root', () => {
  const df = resolve(SVC, 'Dockerfile');
  assert.ok(existsSync(df), 'apps/workflow-worker/Dockerfile must exist');
  const src = read(df);
  assert.match(src, /FROM\s+node:22-slim/, 'Dockerfile must base on node:22-slim (glibc required by @temporalio/core-bridge native binary; Alpine/musl cannot load it)');
  // Numeric, not `USER node` (#965): kubelet resolves runAsNonRoot against the numeric UID only.
  assert.match(src, /USER\s+[1-9]\d*/, 'Dockerfile must run as a numeric non-root UID (#965)');
  // Build from repo root: copies apps/workflow-worker paths (not bare src/).
  assert.match(src, /services\/workflow-worker/, 'Dockerfile must copy from the repo-root apps/workflow-worker path');
  assert.match(src, /CMD\s+\[?["']?node["']?/, 'Dockerfile CMD must launch the node worker process');
});

// ---------------------------------------------------------------------------
// bbx-flows-interp-008: helm — core by default
// ---------------------------------------------------------------------------
test('bbx-flows-interp-008: default core install renders one workflow-worker Deployment', SKIP, () => {
  const r = helmTemplate();
  assert.equal(r.status, 0, `helm template (defaults) must exit 0.\nstderr: ${r.stderr}`);
  const docs = splitDocs(r.stdout);
  const deployments = docs.filter((d) => docKind(d) === 'Deployment' && /workflow-worker/.test(docName(d)));
  assert.equal(deployments.length, 1, `expected one workflow-worker Deployment by default, found ${deployments.length}`);
});

// ---------------------------------------------------------------------------
// bbx-flows-interp-009: helm — worker Deployment with flows-worker label
// ---------------------------------------------------------------------------
test('bbx-flows-interp-009: workflowWorker renders a worker Deployment with the flows-worker label', SKIP, () => {
  const r = helmTemplate();
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  const docs = splitDocs(r.stdout);
  const deployments = docs.filter((d) => docKind(d) === 'Deployment' && /workflow-worker/.test(docName(d)));
  assert.equal(deployments.length, 1, `expected exactly one workflow-worker Deployment, found ${deployments.length}`);
  // NetworkPolicy contract: pod must carry app.kubernetes.io/component: flows-worker.
  assert.match(
    deployments[0],
    /app\.kubernetes\.io\/component:\s*flows-worker/,
    'the worker pod must carry the app.kubernetes.io/component: flows-worker label',
  );
});

// ---------------------------------------------------------------------------
// bbx-flows-interp-010: helm — non-root worker with probes
// ---------------------------------------------------------------------------
test('bbx-flows-interp-010: worker pod spec is non-root with liveness + readiness probes', SKIP, () => {
  const r = helmTemplate();
  assert.equal(r.status, 0, `helm template must exit 0.\nstderr: ${r.stderr}`);
  const docs = splitDocs(r.stdout);
  const dep = docs.find((d) => docKind(d) === 'Deployment' && /workflow-worker/.test(docName(d)));
  assert.ok(dep, 'expected a workflow-worker Deployment');
  assert.match(dep, /runAsNonRoot:\s*true/, 'worker pod must set runAsNonRoot: true');
  assert.match(dep, /readinessProbe:/, 'worker pod must declare a readinessProbe');
  assert.match(dep, /livenessProbe:/, 'worker pod must declare a livenessProbe');
});

// ---------------------------------------------------------------------------
// bbx-flows-interp-011: helm — values.schema.json accepts workflowWorker
// ---------------------------------------------------------------------------
test('bbx-flows-interp-011: values.schema.json accepts workflowWorker (lint + template exit 0)', SKIP, () => {
  const lint = helmLint();
  assert.equal(lint.status, 0, `helm lint must exit 0.\nstderr: ${lint.stderr}\nstdout: ${lint.stdout}`);
  const tmpl = helmTemplate();
  assert.equal(tmpl.status, 0, `helm template must exit 0.\nstderr: ${tmpl.stderr}`);

  // The schema file itself must declare the property referencing the shared component definition.
  const schema = JSON.parse(read(resolve(CHART_PATH, 'values.schema.json')));
  assert.ok(schema.properties?.workflowWorker, 'values.schema.json must declare a workflowWorker property');
});

// ---------------------------------------------------------------------------
// bbx-flows-interp-012: retry-policy + duration mapping helpers (normative contract)
// ---------------------------------------------------------------------------
test('bbx-flows-interp-012: retry-policy mapping helper follows flow-definition-mapping.json bindings', () => {
  const mapping = resolve(SVC, 'src', 'shared', 'mapping.ts');
  assert.ok(existsSync(mapping), 'src/shared/mapping.ts must exist (DSL→Temporal binding helpers)');
  const src = read(mapping);
  // The verbatim field bindings from the normative contract (flow-definition-mapping.json).
  assert.match(src, /maximumAttempts/, 'retry mapping must bind maxAttempts → maximumAttempts');
  assert.match(src, /backoffCoefficient/, 'retry mapping must bind backoffCoefficient');
  assert.match(src, /initialInterval/, 'retry mapping must bind initialInterval');
  assert.match(src, /nonRetryableErrorTypes/, 'retry mapping must bind nonRetryableErrors → nonRetryableErrorTypes');
});

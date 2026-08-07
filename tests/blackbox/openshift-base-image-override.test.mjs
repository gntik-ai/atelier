import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {
  readServiceCatalog,
  parseDockerfileBaseImages,
  collectBaseImageArgViolations,
  collectServiceCatalogViolations,
  REQUIRED_RELEASE_IMAGES,
  RELEASE_WORKFLOW_PATH,
} from '../../scripts/lib/service-catalog.mjs';

// The validator helpers resolve service-catalog.json and apps/<service>/Dockerfile relative to the
// current working directory. run.sh cds to the repo root; make this file robust when run directly.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(repoRoot);

// Ground truth: the base image every released service used BEFORE issue #929. The ARG defaults must
// preserve exactly these so connected builds and release-images.yml stay byte-for-byte unchanged.
const EXPECTED_CURRENT_BASE = {
  'control-plane': 'node:22-alpine',
  'control-plane-executor': 'node:22-alpine',
  'web-console': 'node:22-alpine',
  'workflow-worker': 'node:22-slim',
  'mcp-runtime': 'node:22-alpine',
  'fn-runtime': 'node:22-alpine',
};

// The multi-stage services (web-console, workflow-worker) have two FROM stages; every stage must be
// parameterized because OpenShift `dockerStrategy.from` only rewrites the final FROM.
const EXPECTED_FROM_STAGES = {
  'control-plane': 1,
  'control-plane-executor': 1,
  'web-console': 2,
  'workflow-worker': 2,
  'mcp-runtime': 1,
  'fn-runtime': 1,
};

const PRIVATE_REGISTRY = 'harbor.internal:5000/falcone';

const releaseServices = readServiceCatalog().services.filter((service) => service.release === true);

// Resolve a FROM base token against a map of build-arg values, exactly as `docker build --build-arg`
// substitutes `${NAME}` / `$NAME` in a FROM line. A literal (un-parameterized) base is returned as-is.
function resolveBase(token, argValues) {
  const match = token.match(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/);
  if (!match) return token;
  return argValues.has(match[1]) ? argValues.get(match[1]) : token;
}

// bbx-929-001 | openshift-private-base-images | Scenario: Every FROM stage is overridable
test('every released service Dockerfile parameterizes every FROM stage through a build ARG', () => {
  assert.equal(releaseServices.length, 6);
  for (const service of releaseServices) {
    const {argDefaults, fromRefs} = parseDockerfileBaseImages(service.dockerfile);
    assert.equal(
      fromRefs.length,
      EXPECTED_FROM_STAGES[service.id],
      `${service.id} FROM stage count changed`,
    );
    for (const from of fromRefs) {
      if (from.isStageRef) continue; // `FROM <previous-stage>` is internal, not an external base
      assert.ok(
        from.argName,
        `${service.id}: FROM "${from.raw}" is a literal base image, not a build-arg override`,
      );
      assert.ok(
        argDefaults.get(from.argName),
        `${service.id}: ARG ${from.argName} used by FROM must declare a default base image`,
      );
      assert.doesNotMatch(
        from.raw,
        /^node:/,
        `${service.id}: FROM must not hardcode a Docker Hub node base`,
      );
    }
  }
});

// bbx-929-002 | openshift-private-base-images | Scenario: An overridden build pulls no external base image
test('private-registry base-image overrides make every FROM resolve to that registry only', () => {
  for (const service of releaseServices) {
    const {argDefaults, fromRefs} = parseDockerfileBaseImages(service.dockerfile);
    // Simulate `docker build --build-arg NAME=<harbor ref>` for every declared base-image arg.
    const overrides = new Map();
    for (const [name, def] of argDefaults) {
      if (def == null) continue;
      overrides.set(name, `${PRIVATE_REGISTRY}/library/${def}`);
    }
    const resolved = fromRefs
      .filter((from) => !from.isStageRef)
      .map((from) => resolveBase(from.raw, overrides));
    assert.ok(resolved.length > 0, `${service.id} has no external FROM base`);
    for (const base of resolved) {
      assert.ok(
        base.startsWith(`${PRIVATE_REGISTRY}/`),
        `${service.id}: base "${base}" is not pulled from the private registry after override`,
      );
      assert.doesNotMatch(
        base,
        /^node:/,
        `${service.id}: an implicit Docker Hub base survived the override`,
      );
    }
  }
});

// bbx-929-003 | openshift-private-base-images | Scenario: Default builds are unchanged
test('base-image ARG defaults preserve the current bases for every released service', () => {
  for (const service of releaseServices) {
    const {argDefaults, fromRefs} = parseDockerfileBaseImages(service.dockerfile);
    const expected = EXPECTED_CURRENT_BASE[service.id];
    assert.ok(expected, `test is missing an expected current base for ${service.id}`);
    for (const from of fromRefs.filter((entry) => !entry.isStageRef)) {
      // Resolve every FROM with the DEFAULT arg values (a connected build with no overrides).
      assert.equal(
        resolveBase(from.raw, argDefaults),
        expected,
        `${service.id}: default base drifted from the pre-#929 image`,
      );
    }
  }
});

// bbx-929-004 | openshift-private-base-images | Scenario: The catalog lists the build args
test('service-catalog.json records base-image build args and defaults per released service', () => {
  for (const service of releaseServices) {
    assert.ok(
      Array.isArray(service.baseImageArgs) && service.baseImageArgs.length > 0,
      `${service.id} must record baseImageArgs`,
    );
    const {argDefaults, fromRefs} = parseDockerfileBaseImages(service.dockerfile);
    const usedArgs = new Set(
      fromRefs.filter((from) => !from.isStageRef).map((from) => from.argName).filter(Boolean),
    );
    const recorded = new Map(service.baseImageArgs.map((arg) => [arg.name, arg.default]));
    assert.deepEqual(
      [...recorded.keys()].sort(),
      [...usedArgs].sort(),
      `${service.id}: catalog base-image args must match the Dockerfile FROM args`,
    );
    for (const [name, def] of recorded) {
      assert.equal(typeof name, 'string');
      assert.equal(typeof def, 'string');
      assert.equal(
        def,
        argDefaults.get(name),
        `${service.id}: catalog default for ${name} must equal the Dockerfile ARG default`,
      );
    }
  }
});

// bbx-929-005 | openshift-private-base-images | Scenario: The catalog is the source of truth for drift
test('service-catalog validator flags base-image drift, missing metadata, and a literal FROM', (t) => {
  // The committed repository state is internally consistent.
  assert.deepEqual(collectBaseImageArgViolations(readServiceCatalog()), []);

  // A catalog default that no longer matches the Dockerfile ARG default is drift.
  const drift = readServiceCatalog();
  drift.services.find((service) => service.id === 'control-plane').baseImageArgs[0].default = 'node:20-alpine';
  assert.ok(
    collectBaseImageArgViolations(drift).some((violation) => /drifts from the Dockerfile ARG default/.test(violation)),
    'validator must flag a catalog default that drifts from the Dockerfile',
  );

  // A released service without base-image metadata is a violation.
  const missing = readServiceCatalog();
  delete missing.services.find((service) => service.id === 'fn-runtime').baseImageArgs;
  assert.ok(
    collectBaseImageArgViolations(missing).some((violation) => /must record at least one baseImageArgs/.test(violation)),
    'validator must flag a released service missing baseImageArgs',
  );

  // A released service whose Dockerfile reintroduces a literal, un-parameterized FROM is a violation.
  const literal = readServiceCatalog();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'falcone-df-'));
  // Self-cleaning: remove the scratch Dockerfile dir even if an assertion below throws, so the
  // suite never leaks /tmp/falcone-df-* directories.
  t.after(() => fs.rmSync(tmpDir, {recursive: true, force: true}));
  const tmpDockerfile = path.join(tmpDir, 'Dockerfile');
  fs.writeFileSync(tmpDockerfile, 'FROM node:22-alpine\nWORKDIR /app\nCMD ["node"]\n');
  literal.services.find((service) => service.id === 'mcp-runtime').dockerfile = tmpDockerfile;
  assert.ok(
    collectBaseImageArgViolations(literal).some((violation) => /un-parameterized base/.test(violation)),
    'validator must flag a literal, un-parameterized FROM',
  );
});

// bbx-929-006 | openshift-private-base-images | Scenario: Connected release builds are unaffected
test('release workflow builds the six images with default bases and stays coherent', () => {
  const workflow = fs.readFileSync(RELEASE_WORKFLOW_PATH, 'utf8');
  for (const image of REQUIRED_RELEASE_IMAGES) {
    assert.ok(workflow.includes(image), `release workflow lost ${image}`);
  }
  // The workflow passes no base-image build-arg, so the ARG defaults (current bases) apply and
  // published images are unchanged.
  assert.doesNotMatch(
    workflow,
    /NODE_BASE_IMAGE/,
    'release workflow must not override NODE_BASE_IMAGE; connected builds keep the default bases',
  );
  // Full repository coherence, now including base-image catalog <-> Dockerfile consistency.
  assert.deepEqual(collectServiceCatalogViolations(readServiceCatalog()), []);
});

// Regression guard for issue #965 — "control-plane-executor and workflow-worker images use
// non-numeric USER node, so they cannot start under runAsNonRoot".
//
// Kubernetes resolves `runAsNonRoot: true` against the image config's numeric UID and nothing
// else: it will not consult /etc/passwd inside the image to map a username to a UID. An image
// that declares `USER node` therefore cannot be admitted under a `runAsNonRoot` security context
// unless the Deployment separately pins `runAsUser`, and kubelet parks the pod in
// CreateContainerConfigError with:
//
//   Error: container has runAsNonRoot and image has non-numeric user (node),
//   cannot verify user is non-root
//
// These are file-level assertions on the Dockerfiles (the image's USER is a build-time literal),
// so they run without a cluster or a container runtime — matching the other image-contract
// guards in this directory (scheduling-handler-dockerfile, flows-worker-dockerfile,
// openshift-base-image-override).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {
  readServiceCatalog,
  parseDockerfileFinalUser,
  collectNonRootUserViolations,
  collectServiceCatalogViolations,
} from '../../scripts/lib/service-catalog.mjs';

// The catalog helpers resolve service-catalog.json and apps/<service>/Dockerfile relative to the
// working directory. run.sh cds to the repo root; make this file robust when run directly.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(repoRoot);

const releaseServices = readServiceCatalog().services.filter((service) => service.release === true);

// bbx-965-001 | Scenario: Executor starts under the default security context
// bbx-965-002 | Scenario: Workflow worker starts under the default security context
test('every released service image declares a numeric non-root UID', () => {
  assert.equal(releaseServices.length, 6);
  for (const service of releaseServices) {
    const user = parseDockerfileFinalUser(service.dockerfile);
    assert.notEqual(
      user,
      null,
      `${service.id}: ${service.dockerfile} declares no USER; the image would run as root`,
    );
    const uid = user.split(':')[0];
    assert.match(
      uid,
      /^\d+$/,
      `${service.id}: USER "${user}" is a username, not a numeric UID — kubelet cannot verify `
        + 'runAsNonRoot and the container fails with CreateContainerConfigError (#965)',
    );
    assert.notEqual(Number(uid), 0, `${service.id}: USER "${user}" is root`);
  }
});

// The two images named in #965, pinned by name so a regression cannot be hidden behind a shrinking
// release set. `node` is UID 1000 in both node:22-alpine and node:22-slim, so 1000 is the same
// identity the images already ran as — no file-ownership change accompanies this contract.
test('the two images reported in #965 run as UID 1000, the identity `node` already resolved to', () => {
  for (const id of ['control-plane-executor', 'workflow-worker']) {
    const service = releaseServices.find((entry) => entry.id === id);
    assert.ok(service, `release catalog lost ${id}`);
    assert.equal(
      parseDockerfileFinalUser(service.dockerfile),
      '1000',
      `${id} must declare USER 1000`,
    );
  }
});

// `USER` is stage-scoped: every FROM resets it, so only the final stage's USER reaches the image
// config. The multi-stage services (web-console, workflow-worker) must not pass on a USER that
// only their build stage declared.
test('the USER contract is read from the final build stage only', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'falcone-user-'));
  t.after(() => fs.rmSync(tmpDir, {recursive: true, force: true}));
  const write = (name, body) => {
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, body);
    return file;
  };

  // A USER in an earlier stage is discarded by the next FROM — the image runs as root.
  assert.equal(
    parseDockerfileFinalUser(write('staged', 'FROM node:22 AS build\nUSER 1000\nFROM node:22\nCMD ["node"]\n')),
    null,
  );
  // The last USER in the final stage wins.
  assert.equal(
    parseDockerfileFinalUser(write('last-wins', 'FROM node:22\nUSER root\nRUN true\nUSER 1000\n')),
    '1000',
  );
  // Commented-out and inline-commented directives are handled.
  assert.equal(
    parseDockerfileFinalUser(write('comments', 'FROM node:22\n# USER 65532\nUSER 1000  # numeric (#965)\n')),
    '1000',
  );
});

// bbx-965-003 | The validator flags the regression rather than trusting the committed state.
test('the non-root UID validator flags a username, root, and a missing USER', () => {
  // The committed repository state satisfies the contract.
  assert.deepEqual(collectNonRootUserViolations(readServiceCatalog()), []);

  const scenarios = [
    ['FROM node:22-alpine\nUSER node\nCMD ["node"]\n', /not a numeric UID/],
    ['FROM node:22-alpine\nUSER 0\nCMD ["node"]\n', /UID 0 \(root\)/],
    ['FROM node:22-alpine\nUSER root\nCMD ["node"]\n', /not a numeric UID/],
    ['FROM node:22-alpine\nCMD ["node"]\n', /declares no USER in its final stage/],
  ];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'falcone-user-df-'));
  try {
    scenarios.forEach(([body, expected], index) => {
      const dockerfile = path.join(tmpDir, `Dockerfile.${index}`);
      fs.writeFileSync(dockerfile, body);
      const catalog = readServiceCatalog();
      catalog.services.find((service) => service.id === 'control-plane-executor').dockerfile = dockerfile;
      const violations = collectNonRootUserViolations(catalog);
      assert.ok(
        violations.some((violation) => expected.test(violation)),
        `validator must flag ${JSON.stringify(body)}; got ${JSON.stringify(violations)}`,
      );
    });
  } finally {
    fs.rmSync(tmpDir, {recursive: true, force: true});
  }
});

// The guard is part of full repository coherence, so `scripts/validate-structure.mjs` and the
// existing catalog test fail the build on a reintroduced named USER — not just this file.
test('the non-root UID contract is enforced by the aggregate service-catalog validator', () => {
  assert.deepEqual(collectServiceCatalogViolations(readServiceCatalog()), []);

  const regressed = readServiceCatalog();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'falcone-user-agg-'));
  try {
    const dockerfile = path.join(tmpDir, 'Dockerfile');
    fs.writeFileSync(dockerfile, 'ARG NODE_BASE_IMAGE=node:22-alpine\nFROM ${NODE_BASE_IMAGE}\nUSER node\nCMD ["node"]\n');
    regressed.services.find((service) => service.id === 'workflow-worker').dockerfile = dockerfile;
    assert.ok(
      collectServiceCatalogViolations(regressed).some((violation) => /not a numeric UID/.test(violation)),
      'the aggregate validator must surface a reintroduced non-numeric USER',
    );
  } finally {
    fs.rmSync(tmpDir, {recursive: true, force: true});
  }
});

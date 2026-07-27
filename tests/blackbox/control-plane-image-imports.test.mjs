/**
 * Production control-plane image import-completeness regression.
 *
 * The Dockerfile deliberately copies the flat apps/control-plane runtime by an
 * explicit allowlist. Follow every relative .mjs import reachable from
 * server.mjs and require the matching source to appear in that allowlist. The
 * image build also imports the side-effect-free database-startup seam, so the
 * original missing COPY is both statically guarded and exercised by Node's ESM
 * resolver inside the production filesystem layout.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTROL_PLANE_DIR = resolve(REPO_ROOT, 'apps', 'control-plane');
const dockerfile = readFileSync(resolve(CONTROL_PLANE_DIR, 'Dockerfile'), 'utf8');

const copiedControlPlaneModules = new Set(
  [...dockerfile.matchAll(/apps\/control-plane\/([A-Za-z0-9_.-]+\.mjs)\b/g)]
    .map((match) => match[1]),
);

function relativeModuleImports(modulePath) {
  const source = readFileSync(modulePath, 'utf8');
  const specifiers = [
    ...source.matchAll(
      /(?:^|\n)\s*import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+\.mjs)['"]/g,
    ),
    ...source.matchAll(/import\(\s*['"]([^'"]+\.mjs)['"]\s*\)/g),
  ].map((match) => match[1]);
  return [...new Set(specifiers.filter((specifier) => specifier.startsWith('./')))];
}

function reachableLocalModules(entryName) {
  const pending = [resolve(CONTROL_PLANE_DIR, entryName)];
  const visited = new Set();
  while (pending.length > 0) {
    const modulePath = pending.pop();
    if (visited.has(modulePath)) continue;
    visited.add(modulePath);
    for (const specifier of relativeModuleImports(modulePath)) {
      pending.push(resolve(dirname(modulePath), specifier));
    }
  }
  return visited;
}

test('bbx-c25-control-plane-image-01: every local server import is in the explicit image COPY list', () => {
  const reachable = reachableLocalModules('server.mjs');
  const missing = [...reachable]
    .map((modulePath) => relative(CONTROL_PLANE_DIR, modulePath))
    .filter((moduleName) => !copiedControlPlaneModules.has(moduleName))
    .sort();

  assert.deepEqual(
    missing,
    [],
    `apps/control-plane/Dockerfile is missing local server imports: ${missing.join(', ')}`,
  );
});

test('bbx-c25-control-plane-image-02: every reachable local server module exists in source', () => {
  for (const modulePath of reachableLocalModules('server.mjs')) {
    assert.ok(
      existsSync(modulePath),
      `${relative(REPO_ROOT, modulePath)} must exist`,
    );
  }
});

test('bbx-c25-control-plane-image-03: the production build imports the database-startup seam', () => {
  assert.ok(
    copiedControlPlaneModules.has('control-plane-database-startup.mjs'),
    'the production image must COPY control-plane-database-startup.mjs',
  );
  assert.match(
    dockerfile,
    /RUN node -e "import\('\.\/control-plane-database-startup\.mjs'\)[\s\S]*process\.exit\(1\)/,
    'the production build must fail when the database-startup ESM graph cannot be imported',
  );
});

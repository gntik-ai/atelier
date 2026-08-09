/**
 * Managed-Knative (#933) deployment & migration contract.
 *
 * The runtime status source, the durable cleanup repository, and the cleanup-obligation table must
 * SHIP and START in both service images and survive an application rollback. These guards turn a
 * missing/mis-targeted COPY, a lost migration, or a destructive rollback into a failing test rather
 * than a runtime CrashLoopBackOff or a silently dropped obligation queue.
 *
 * Scope note: this file only asserts deployment/migration invariants. The status-parsing, gate,
 * cleanup-worker and OpenAPI behaviours are covered by tests/unit/knative-runtime*.test.mjs,
 * tests/unit/runtime-cleanup-repository.test.mjs and tests/contracts/knative-runtime.contract.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GOVERNANCE_MIGRATIONS } from '../../apps/control-plane/governance-schema.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoPath = (...p) => resolve(REPO_ROOT, ...p);
const read = (p) => readFileSync(repoPath(p), 'utf8');
const toPosix = (p) => p.split(/[\\/]/).join('/');

const MIGRATION_REL = 'packages/provisioning-orchestrator/src/migrations/122-knative-runtime-cleanup.sql';

// --------------------------------------------------------------------------------------------------
// 1. Executor image cross-app import closure
//
// The executor runtime is COPY'd into the image under /app/apps/control-plane-executor/src, and its
// main.mjs imports the control-plane runtime/cleanup modules by a repository-relative specifier
// (../../../../apps/control-plane/*.mjs). For those imports to resolve inside the image the executor
// Dockerfile must COPY each reachable control-plane module to *exactly* the path the specifier
// resolves to. A "is the filename mentioned" regex is not sufficient: a COPY to the wrong destination
// still mentions the file yet crash-loops with ERR_MODULE_NOT_FOUND at runtime.
// --------------------------------------------------------------------------------------------------

const EXECUTOR_DOCKERFILE = 'apps/control-plane-executor/Dockerfile';
const EXECUTOR_MAIN_REL = 'apps/control-plane-executor/src/runtime/main.mjs';
// Derived from `COPY apps/control-plane-executor/src /app/apps/control-plane-executor/src`.
const EXECUTOR_MAIN_IMAGE = '/app/apps/control-plane-executor/src/runtime/main.mjs';

function parseCopies(dockerfile) {
  const copies = [];
  for (const line of dockerfile.split('\n')) {
    const match = /^\s*COPY\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const args = match[1].trim().split(/\s+/);
    if (args.length < 2 || args.some((arg) => arg.startsWith('--'))) continue; // skip --from/--chown forms
    const dest = toPosix(args[args.length - 1]);
    for (const src of args.slice(0, -1)) copies.push({ src: toPosix(src), dest });
  }
  return copies;
}

// True when some COPY places the repo file `repoRel` at the image path `imageAbs` — either as an
// explicit single-file COPY or as a member of a copied directory (preserving the relative suffix).
function coveredByCopy(repoRel, imageAbs, copies) {
  for (const { src, dest } of copies) {
    if (src === repoRel && dest === imageAbs) return true; // exact file copy
    const rel = posix.relative(src, repoRel);
    if (rel && !rel.startsWith('..') && posix.join(dest, rel) === imageAbs) return true; // dir copy
  }
  return false;
}

function relativeMjsImports(source) {
  const specifiers = [
    ...source.matchAll(/(?:^|\n)\s*import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+\.mjs)['"]/g),
    ...source.matchAll(/\bimport\(\s*['"]([^'"]+\.mjs)['"]\s*\)/g),
  ].map((match) => match[1]);
  return [...new Set(specifiers.filter((specifier) => specifier.startsWith('.')))];
}

test('knative-deploy-01: executor image COPYs the #933 control-plane import closure to resolvable paths', () => {
  const copies = parseCopies(read(EXECUTOR_DOCKERFILE));

  // Seed with main.mjs imports that escape the executor src tree into apps/control-plane/ (the new
  // cross-app dependency direction introduced by #933). Intra-src (./…) and packages/… imports are
  // covered by their own directory COPYs and by the executor image's existing shipping history.
  const seeds = [];
  for (const specifier of relativeMjsImports(read(EXECUTOR_MAIN_REL))) {
    const repoRel = toPosix(relative(REPO_ROOT, resolve(dirname(repoPath(EXECUTOR_MAIN_REL)), specifier)));
    if (!repoRel.startsWith('apps/control-plane/')) continue;
    seeds.push({ repoRel, imageAbs: posix.resolve(posix.dirname(EXECUTOR_MAIN_IMAGE), specifier) });
  }
  assert.ok(seeds.length >= 2, 'executor main.mjs must import the control-plane runtime + cleanup modules');

  // Walk the transitive .mjs closure of each seed and require every module to be shipped where it
  // resolves. Today the two seam modules are self-contained; this guards a future control-plane import
  // being dragged into the executor image without a matching COPY.
  const visited = new Set();
  const pending = [...seeds];
  while (pending.length > 0) {
    const node = pending.pop();
    if (visited.has(node.repoRel)) continue;
    visited.add(node.repoRel);

    assert.ok(existsSync(repoPath(node.repoRel)), `${node.repoRel} must exist in source`);
    assert.ok(
      coveredByCopy(node.repoRel, node.imageAbs, copies),
      `executor Dockerfile must COPY ${node.repoRel} -> ${node.imageAbs} (import closure); `
        + 'a missing/mis-targeted COPY crash-loops the executor at runtime',
    );

    for (const specifier of relativeMjsImports(read(node.repoRel))) {
      pending.push({
        repoRel: toPosix(relative(REPO_ROOT, resolve(dirname(repoPath(node.repoRel)), specifier))),
        imageAbs: posix.resolve(posix.dirname(node.imageAbs), specifier),
      });
    }
  }

  assert.ok(visited.has('apps/control-plane/knative-runtime.mjs'), 'runtime status source must be in the closure');
  assert.ok(visited.has('apps/control-plane/runtime-cleanup-repository.mjs'), 'cleanup repository must be in the closure');
});

// --------------------------------------------------------------------------------------------------
// 2. Migration ships in BOTH control-plane boot paths, ordered
// --------------------------------------------------------------------------------------------------

test('knative-deploy-02: obligations schema is created in both control-plane boot paths, after 121', () => {
  const migration = read(MIGRATION_REL);
  const ensureSchema = read('apps/control-plane/tenant-store.mjs');
  const required = read('apps/control-plane/required-migrations.txt');

  // (a) the numbered product migration — governance boot recovery set + planning manifest + on disk.
  assert.ok(existsSync(repoPath(MIGRATION_REL)), 'migration 122 must exist on disk');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS\s+runtime_cleanup_obligations/);
  assert.ok(GOVERNANCE_MIGRATIONS.includes(MIGRATION_REL), 'migration 122 must be in GOVERNANCE_MIGRATIONS');
  assert.match(required, /122-knative-runtime-cleanup\.sql/, 'migration 122 must be in required-migrations.txt');

  const idx121 = GOVERNANCE_MIGRATIONS.findIndex((rel) => rel.includes('121-flow-quota'));
  const idx122 = GOVERNANCE_MIGRATIONS.findIndex((rel) => rel.includes('122-knative-runtime-cleanup'));
  assert.ok(idx121 >= 0 && idx122 > idx121, 'migration 122 must be ordered after 121 in the recovery set');

  // (b) the hand-written domain-B ensureSchema — what actually runs first at kind boot. It must also
  // create the table (and the fn_actions lifecycle columns) idempotently, so both boot orders converge.
  assert.match(ensureSchema, /CREATE TABLE IF NOT EXISTS\s+runtime_cleanup_obligations/);
  assert.match(ensureSchema, /ALTER TABLE fn_actions ADD COLUMN IF NOT EXISTS lifecycle_status/);
});

// --------------------------------------------------------------------------------------------------
// 3. Retain-by-default / rollback safety
//
// "Removing code must not drop the cleanup table while obligations exist." The DDL is forward-only
// and idempotent in every boot path; no code path drops or truncates the obligation queue. This guard
// fails a future destructive edit before it can lose a tenant's pending teardown work.
// --------------------------------------------------------------------------------------------------

test('knative-deploy-03: no boot path drops or truncates the durable obligation queue', () => {
  const boots = [
    ['migration', read(MIGRATION_REL)],
    ['ensureSchema', read('apps/control-plane/tenant-store.mjs')],
  ];
  for (const [name, sql] of boots) {
    assert.doesNotMatch(sql, /DROP\s+TABLE[^;]*runtime_cleanup_obligations/i, `${name} must not drop the obligations table`);
    assert.doesNotMatch(sql, /TRUNCATE[^;]*runtime_cleanup_obligations/i, `${name} must not truncate the obligations table`);
    assert.doesNotMatch(sql, /DROP\s+COLUMN[^;]*lifecycle_status/i, `${name} must not drop the fn_actions lifecycle column`);
  }
  // The planning manifest records the retain-on-rollback contract for operators.
  assert.match(read('apps/control-plane/required-migrations.txt'), /rollback must not drop the table/i);
});

// --------------------------------------------------------------------------------------------------
// 4. Least privilege & safe default
// --------------------------------------------------------------------------------------------------

test('knative-deploy-04: both runtime images run non-root and default managed-Knative OFF', () => {
  for (const dockerfilePath of [EXECUTOR_DOCKERFILE, 'apps/control-plane/Dockerfile']) {
    const dockerfile = read(dockerfilePath);
    const user = /(?:^|\n)\s*USER\s+(\S+)/i.exec(dockerfile)?.[1];
    assert.ok(user && user !== 'root' && user !== '0', `${dockerfilePath} must set a non-root USER (got ${user ?? 'none'})`);
    assert.match(dockerfile, /KNATIVE_RUNTIME_MODE=disabled/, `${dockerfilePath} must default managed-Knative to disabled`);
  }
});

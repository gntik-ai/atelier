import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildArtifacts,
  checkMigrationParity,
  computeDrift,
  deriveSubsets,
  renderBackendModule,
  renderConsoleDeclaration,
  renderConsoleModule,
  renderQueryResponseSchema,
  renderStateChangedSchema,
  runGeneration,
  validateCatalog,
} from '../../scripts/generate-async-operation-status-vocabulary.mjs';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../..');
const SOURCE_PATH = 'packages/internal-contracts/src/async-operation-status-vocabulary.json';
const QUERY_SCHEMA_PATH = 'packages/internal-contracts/src/async-operation-query-response.json';
const EVENT_SCHEMA_PATH = 'packages/internal-contracts/src/async-operation-state-changed.json';
const MIGRATION_PATH = 'packages/provisioning-orchestrator/src/migrations/076-timeout-cancel-recovery.sql';
const GENERATED_SCHEMA_ANNOTATION = {
  source: SOURCE_PATH,
  generator: 'scripts/generate-async-operation-status-vocabulary.mjs',
  command: 'pnpm generate:async-operation-status-vocabulary'
};

async function readCatalog() {
  return JSON.parse(await readFile(path.join(REPOSITORY_ROOT, SOURCE_PATH), 'utf8'));
}

async function createFixtureRepository(t) {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'falcone-c12-generator-'));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));

  for (const relativePath of [SOURCE_PATH, QUERY_SCHEMA_PATH, EVENT_SCHEMA_PATH, MIGRATION_PATH]) {
    const destination = path.join(fixtureRoot, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(REPOSITORY_ROOT, relativePath), destination);
  }
  return fixtureRoot;
}

test('C-12 catalog pins values, lifecycle subsets, labels, tones, and graph invariants', async () => {
  const catalog = await readCatalog();
  validateCatalog(catalog);
  const derived = deriveSubsets(catalog);

  assert.deepEqual(derived.values, [
    'pending',
    'running',
    'completed',
    'failed',
    'timed_out',
    'cancelling',
    'cancelled'
  ]);
  assert.deepEqual(derived.active, ['pending', 'running', 'cancelling']);
  assert.deepEqual(derived.terminal, ['completed', 'failed', 'timed_out', 'cancelled']);
  assert.deepEqual(derived.cancellable, ['pending', 'running']);
  assert.equal(catalog.statuses.find((entry) => entry.value === 'cancelling').consoleLabel, 'Cancelando');

  const invalidCatalogs = [
    { name: 'unsupported version', mutate: (copy) => { copy.version = 2; } },
    { name: 'duplicate/missing value', mutate: (copy) => { copy.statuses[6].value = 'cancelling'; } },
    { name: 'overlapping classification', mutate: (copy) => { copy.statuses[0].terminal = true; } },
    { name: 'cancellable terminal status', mutate: (copy) => { copy.statuses[2].cancellable = true; } },
    { name: 'unknown transition target', mutate: (copy) => { copy.statuses[0].transitions.push('unknown'); } },
    { name: 'terminal outgoing transition', mutate: (copy) => { copy.statuses[2].transitions.push('failed'); } },
    { name: 'blank console label', mutate: (copy) => { copy.statuses[5].consoleLabel = ' '; } },
    { name: 'unsupported tone', mutate: (copy) => { copy.statuses[5].consoleTone = 'purple'; } }
  ];

  for (const { name, mutate } of invalidCatalogs) {
    const invalid = structuredClone(catalog);
    mutate(invalid);
    assert.throws(() => validateCatalog(invalid), /Invalid async-operation status catalog/, name);
  }
});

test('C-12 renderers propagate a structurally coherent rename, addition, reorder, and known edge', async () => {
  const catalog = await readCatalog();
  const evolved = structuredClone(catalog);
  const running = evolved.statuses.find((entry) => entry.value === 'running');
  const pending = evolved.statuses.find((entry) => entry.value === 'pending');
  const timedOut = evolved.statuses.find((entry) => entry.value === 'timed_out');
  timedOut.value = 'expired';
  running.transitions = running.transitions.map((target) => target === 'timed_out' ? 'expired' : target);
  pending.transitions.push('failed');
  evolved.statuses.push({
    value: 'superseded',
    active: false,
    terminal: true,
    cancellable: false,
    transitions: [],
    consoleLabel: 'Sustituida',
    consoleTone: 'neutral'
  });
  [evolved.statuses[0], evolved.statuses[1]] = [evolved.statuses[1], evolved.statuses[0]];

  assert.doesNotThrow(() => validateCatalog(evolved));
  const derived = deriveSubsets(evolved);
  assert.equal(derived.values.includes('expired'), true);
  assert.equal(derived.values.includes('superseded'), true);
  assert.equal(derived.values.includes('timed_out'), false);

  const backend = renderBackendModule(evolved);
  const consoleRuntime = renderConsoleModule(evolved);
  const consoleDeclaration = renderConsoleDeclaration(evolved);
  assert.match(backend, /expired/);
  assert.match(backend, /superseded/);
  assert.match(backend, /pending: Object\.freeze\(\['running', 'cancelled', 'failed'\]\)/);
  assert.match(consoleRuntime, /superseded: 'Sustituida'/);
  assert.match(consoleDeclaration, /'superseded'/);

  const querySchema = JSON.parse(renderQueryResponseSchema(
    evolved,
    await readFile(path.join(REPOSITORY_ROOT, QUERY_SCHEMA_PATH), 'utf8')
  ));
  const eventSchema = JSON.parse(renderStateChangedSchema(
    evolved,
    await readFile(path.join(REPOSITORY_ROOT, EVENT_SCHEMA_PATH), 'utf8')
  ));
  assert.deepEqual(querySchema.definitions.OperationStatus.enum, derived.values);
  assert.deepEqual(eventSchema.properties.previousStatus.enum, derived.values);
  assert.deepEqual(eventSchema.properties.newStatus.enum, derived.values);
});

test('C-12 generation is byte-identical, schema-bounded, and check mode is no-write', async (t) => {
  const fixtureRoot = await createFixtureRepository(t);

  const initialGeneration = runGeneration({ rootDir: fixtureRoot });
  assert.equal(initialGeneration.parityProblems.length, 0);
  assert.deepEqual(initialGeneration.written, [
    'packages/provisioning-orchestrator/src/generated/async-operation-status-vocabulary.mjs',
    'apps/web-console/src/lib/generated/async-operation-status-vocabulary.mjs',
    'apps/web-console/src/lib/generated/async-operation-status-vocabulary.d.mts'
  ]);
  const firstRender = buildArtifacts(fixtureRoot);
  const firstBytes = new Map(await Promise.all(firstRender.map(async ({ relPath }) => [
    relPath,
    await readFile(path.join(fixtureRoot, relPath), 'utf8')
  ])));

  const repeatedGeneration = runGeneration({ rootDir: fixtureRoot });
  assert.deepEqual(repeatedGeneration.written, []);
  const secondRender = buildArtifacts(fixtureRoot);
  assert.deepEqual(secondRender, firstRender);
  for (const [relativePath, bytes] of firstBytes) {
    assert.equal(await readFile(path.join(fixtureRoot, relativePath), 'utf8'), bytes, relativePath);
  }

  const stalePath = firstRender[0].relPath;
  await writeFile(path.join(fixtureRoot, stalePath), `${firstBytes.get(stalePath)}// stale\n`, 'utf8');
  const beforeCheck = await readFile(path.join(fixtureRoot, stalePath), 'utf8');
  const checkResult = runGeneration({ rootDir: fixtureRoot, check: true });
  assert.deepEqual(checkResult.stale, [stalePath]);
  assert.equal(await readFile(path.join(fixtureRoot, stalePath), 'utf8'), beforeCheck, 'check mode must not repair a stale file');

  const secondStalePath = firstRender[1].relPath;
  await rm(path.join(fixtureRoot, secondStalePath));
  assert.deepEqual(computeDrift(fixtureRoot, firstRender), {
    missing: [secondStalePath],
    stale: [stalePath]
  });

  const querySchema = JSON.parse(firstBytes.get(QUERY_SCHEMA_PATH));
  const eventSchema = JSON.parse(firstBytes.get(EVENT_SCHEMA_PATH));
  assert.deepEqual(querySchema['x-falcone-generated-status-vocabulary'], GENERATED_SCHEMA_ANNOTATION);
  assert.deepEqual(eventSchema['x-falcone-generated-status-vocabulary'], GENERATED_SCHEMA_ANNOTATION);
  assert.deepEqual(querySchema.definitions.OperationStatus.enum, deriveSubsets(await readCatalog()).values);
  assert.deepEqual(eventSchema.properties.previousStatus.enum, querySchema.definitions.OperationStatus.enum);
  assert.deepEqual(eventSchema.properties.newStatus.enum, querySchema.definitions.OperationStatus.enum);
});

test('C-12 generation fails before writes when a managed schema pointer is absent', async (t) => {
  const fixtureRoot = await createFixtureRepository(t);
  const queryPath = path.join(fixtureRoot, QUERY_SCHEMA_PATH);
  const querySchema = JSON.parse(await readFile(queryPath, 'utf8'));
  delete querySchema.definitions.OperationStatus.enum;
  await writeFile(queryPath, `${JSON.stringify(querySchema, null, 2)}\n`, 'utf8');

  assert.throws(() => buildArtifacts(fixtureRoot), /\/definitions\/OperationStatus\/enum/);
  await assert.rejects(() => readFile(path.join(fixtureRoot, 'packages/provisioning-orchestrator/src/generated/async-operation-status-vocabulary.mjs')), { code: 'ENOENT' });
});

test('C-12 write mode does not emit incompatible artifacts when migration parity fails', async (t) => {
  const fixtureRoot = await createFixtureRepository(t);
  const catalogPath = path.join(fixtureRoot, SOURCE_PATH);
  const queryPath = path.join(fixtureRoot, QUERY_SCHEMA_PATH);
  const queryBefore = await readFile(queryPath, 'utf8');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const running = catalog.statuses.find((entry) => entry.value === 'running');
  const timedOut = catalog.statuses.find((entry) => entry.value === 'timed_out');
  timedOut.value = 'expired';
  running.transitions = running.transitions.map((target) => target === 'timed_out' ? 'expired' : target);
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

  const result = runGeneration({ rootDir: fixtureRoot });
  assert.equal(result.parityProblems.length > 0, true);
  assert.deepEqual(result.written, []);
  assert.equal(await readFile(queryPath, 'utf8'), queryBefore);
  await assert.rejects(
    () => readFile(path.join(fixtureRoot, 'packages/provisioning-orchestrator/src/generated/async-operation-status-vocabulary.mjs')),
    { code: 'ENOENT' }
  );
});

test('C-12 migration parity ignores comments and rejects executable ambiguity or drift', async (t) => {
  const fixtureRoot = await createFixtureRepository(t);
  const migrationPath = path.join(fixtureRoot, MIGRATION_PATH);
  const migration = await readFile(migrationPath, 'utf8');
  await writeFile(
    migrationPath,
    `${migration}\n-- ALTER TABLE async_operations ADD CONSTRAINT async_operations_status_check CHECK (status IN ('bad'));\n`,
    'utf8'
  );
  assert.deepEqual(checkMigrationParity(fixtureRoot).problems, []);

  await writeFile(
    migrationPath,
    `${migration}\nALTER TABLE async_operations ADD CONSTRAINT async_operations_status_check CHECK (status IN ('bad'));\n`,
    'utf8'
  );
  assert.throws(
    () => checkMigrationParity(fixtureRoot),
    /Expected exactly one executable async_operations_status_check constraint/
  );

  await writeFile(migrationPath, migration.replace("'cancelling'", "'incorrect'"), 'utf8');
  assert.equal(checkMigrationParity(fixtureRoot).problems.some((problem) => problem.includes('status constraint')), true);
});

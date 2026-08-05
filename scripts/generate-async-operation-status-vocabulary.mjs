#!/usr/bin/env node
// Deterministic generator for the canonical async-operation status vocabulary (C-12).
//
// Single source of truth:
//   packages/internal-contracts/src/async-operation-status-vocabulary.json
//
// It renders, from that catalog alone, the committed backend constants, the two
// internal JSON-schema status enums, and the Operations console runtime/declaration
// artifacts. Output is byte-stable: no clock, locale, network, random, or
// working-directory input is consulted, so generating twice yields identical bytes.
//
//   node scripts/generate-async-operation-status-vocabulary.mjs           # write changed artifacts
//   node scripts/generate-async-operation-status-vocabulary.mjs --check   # no-write drift + migration parity gate
//
// The check mode never writes; it compares expected bytes against every committed
// artifact, reports the exact stale/missing paths in fixed path order, and also
// verifies that immutable migration 076 still mirrors the catalog.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

export const CATALOG_REL = 'packages/internal-contracts/src/async-operation-status-vocabulary.json';
export const BACKEND_REL = 'packages/provisioning-orchestrator/src/generated/async-operation-status-vocabulary.mjs';
export const CONSOLE_REL = 'apps/web-console/src/lib/generated/async-operation-status-vocabulary.mjs';
export const CONSOLE_DTS_REL = 'apps/web-console/src/lib/generated/async-operation-status-vocabulary.d.mts';
export const QUERY_RESPONSE_REL = 'packages/internal-contracts/src/async-operation-query-response.json';
export const STATE_CHANGED_REL = 'packages/internal-contracts/src/async-operation-state-changed.json';
export const MIGRATION_REL = 'packages/provisioning-orchestrator/src/migrations/076-timeout-cancel-recovery.sql';

export const GENERATE_COMMAND = 'pnpm generate:async-operation-status-vocabulary';
export const CHECK_COMMAND = 'pnpm validate:async-operation-status-vocabulary';

export const SUPPORTED_TONES = Object.freeze(['neutral', 'progress', 'success', 'danger', 'warning']);

const SCHEMA_ANNOTATION_KEY = 'x-falcone-generated-status-vocabulary';

const CONSTRAINT_PATTERN =
  /ADD\s+CONSTRAINT\s+async_operations_status_check\s+CHECK\s*\(\s*status\s+IN\s*\(([\s\S]*?)\)\s*\)/gi;
const INDEX_PATTERN =
  /CREATE\s+INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+idx_async_ops_status_updated\b[\s\S]*?WHERE\s+status\s+IN\s*\(([\s\S]*?)\)\s*;/gi;

// ----------------------------------------------------------------------------- catalog

export function readCatalog(rootDir = REPO_ROOT) {
  const raw = fs.readFileSync(path.join(rootDir, CATALOG_REL), 'utf8');
  return JSON.parse(raw);
}

export function validateCatalog(catalog) {
  const errors = [];

  if (!catalog || typeof catalog !== 'object') {
    throw new Error('async-operation status catalog must be an object');
  }
  if (catalog.version !== 1) {
    errors.push('version must be 1');
  }
  const statuses = catalog.statuses;
  if (!Array.isArray(statuses) || statuses.length === 0) {
    throw new Error('async-operation status catalog: "statuses" must be a non-empty array');
  }

  const seen = new Set();
  const knownValues = new Set();
  for (const entry of statuses) {
    if (entry && typeof entry.value === 'string') {
      knownValues.add(entry.value);
    }
  }

  statuses.forEach((entry, index) => {
    const at = `statuses[${index}]`;
    if (!entry || typeof entry !== 'object') {
      errors.push(`${at} must be an object`);
      return;
    }

    const { value, active, terminal, cancellable, transitions, consoleLabel, consoleTone } = entry;

    if (typeof value !== 'string' || !/^[a-z][a-z0-9_]*$/.test(value)) {
      errors.push(`${at}.value must be a non-empty lower_snake_case string`);
    } else if (seen.has(value)) {
      errors.push(`${at}.value is a duplicate: ${value}`);
    } else {
      seen.add(value);
    }

    if (typeof active !== 'boolean') errors.push(`${at}.active must be a boolean`);
    if (typeof terminal !== 'boolean') errors.push(`${at}.terminal must be a boolean`);
    if (typeof cancellable !== 'boolean') errors.push(`${at}.cancellable must be a boolean`);
    if (typeof active === 'boolean' && typeof terminal === 'boolean' && active === terminal) {
      errors.push(`${at} must be exactly one of active or terminal (value=${value ?? '?'})`);
    }
    if (cancellable === true && active !== true) {
      errors.push(`${at} cancellable statuses must be active (value=${value ?? '?'})`);
    }
    if (typeof consoleLabel !== 'string' || consoleLabel.trim() === '') {
      errors.push(`${at}.consoleLabel must be a non-empty string`);
    }
    if (!SUPPORTED_TONES.includes(consoleTone)) {
      errors.push(`${at}.consoleTone must be one of ${SUPPORTED_TONES.join(', ')} (got ${JSON.stringify(consoleTone)})`);
    }

    if (!Array.isArray(transitions)) {
      errors.push(`${at}.transitions must be an array`);
      return;
    }
    if (new Set(transitions).size !== transitions.length) {
      errors.push(`${at}.transitions must not contain duplicates`);
    }
    for (const target of transitions) {
      if (!knownValues.has(target)) {
        errors.push(`${at}.transitions references an unknown status: ${JSON.stringify(target)}`);
      }
    }
    if (terminal === true && transitions.length > 0) {
      errors.push(`${at} terminal status must have no outgoing transitions (value=${value ?? '?'})`);
    }
  });

  if (errors.length > 0) {
    throw new Error(`Invalid async-operation status catalog:\n- ${errors.join('\n- ')}`);
  }

  return catalog;
}

export function deriveSubsets(catalog) {
  return {
    values: catalog.statuses.map((entry) => entry.value),
    active: catalog.statuses.filter((entry) => entry.active).map((entry) => entry.value),
    terminal: catalog.statuses.filter((entry) => entry.terminal).map((entry) => entry.value),
    cancellable: catalog.statuses.filter((entry) => entry.cancellable).map((entry) => entry.value),
    labels: catalog.statuses.map((entry) => [entry.value, entry.consoleLabel]),
    tones: catalog.statuses.map((entry) => [entry.value, entry.consoleTone]),
    transitions: catalog.statuses.map((entry) => [entry.value, entry.transitions])
  };
}

// ----------------------------------------------------------------------------- rendering helpers

function jsHeader() {
  return [
    '// @generated by scripts/generate-async-operation-status-vocabulary.mjs — DO NOT EDIT BY HAND.',
    `// Source of truth: ${CATALOG_REL}`,
    `// Regenerate: ${GENERATE_COMMAND}`,
    `// Verify (no-write drift check): ${CHECK_COMMAND}`
  ].join('\n');
}

function jsStringArray(values) {
  return `[${values.map((value) => `'${value}'`).join(', ')}]`;
}

function uniqueInOrder(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

// ----------------------------------------------------------------------------- renderers

export function renderBackendModule(catalog) {
  const { values, active, terminal, cancellable, transitions } = deriveSubsets(catalog);
  const transitionLines = transitions
    .map(([value, targets]) => `  ${value}: Object.freeze(${jsStringArray(targets)})`)
    .join(',\n');

  return `${jsHeader()}

export const OPERATION_STATUSES = Object.freeze(${jsStringArray(values)});

export const ACTIVE_STATUSES = Object.freeze(${jsStringArray(active)});

export const TERMINAL_STATUSES = Object.freeze(${jsStringArray(terminal)});

export const CANCELLABLE_STATUSES = Object.freeze(${jsStringArray(cancellable)});

export const OPERATION_STATUS_SET = Object.freeze(new Set(OPERATION_STATUSES));

export const ACTIVE_STATUS_SET = Object.freeze(new Set(ACTIVE_STATUSES));

export const TERMINAL_STATUS_SET = Object.freeze(new Set(TERMINAL_STATUSES));

export const CANCELLABLE_STATUS_SET = Object.freeze(new Set(CANCELLABLE_STATUSES));

export const STATUS_TRANSITIONS = Object.freeze({
${transitionLines}
});
`;
}

export function renderConsoleModule(catalog) {
  const { values, active, terminal, cancellable, labels, tones } = deriveSubsets(catalog);
  const labelLines = labels.map(([value, label]) => `  ${value}: '${label}'`).join(',\n');
  const toneLines = tones.map(([value, tone]) => `  ${value}: '${tone}'`).join(',\n');

  return `${jsHeader()}

export const OPERATION_STATUSES = Object.freeze(${jsStringArray(values)});

export const ACTIVE_STATUSES = Object.freeze(${jsStringArray(active)});

export const TERMINAL_STATUSES = Object.freeze(${jsStringArray(terminal)});

export const CANCELLABLE_STATUSES = Object.freeze(${jsStringArray(cancellable)});

export const OPERATION_STATUS_SET = Object.freeze(new Set(OPERATION_STATUSES));

export const ACTIVE_STATUS_SET = Object.freeze(new Set(ACTIVE_STATUSES));

export const TERMINAL_STATUS_SET = Object.freeze(new Set(TERMINAL_STATUSES));

export const CANCELLABLE_STATUS_SET = Object.freeze(new Set(CANCELLABLE_STATUSES));

export const OPERATION_STATUS_LABELS = Object.freeze({
${labelLines}
});

export const OPERATION_STATUS_TONES = Object.freeze({
${toneLines}
});
`;
}

export function renderConsoleDeclaration(catalog) {
  const { values, active, terminal, cancellable, tones } = deriveSubsets(catalog);
  const union = (list) => list.map((value) => `'${value}'`).join(' | ');
  const toneUnion = union(uniqueInOrder(tones.map(([, tone]) => tone)));

  return `${jsHeader()}

export type OperationStatus = ${union(values)};

export type ActiveOperationStatus = ${union(active)};

export type TerminalOperationStatus = ${union(terminal)};

export type CancellableOperationStatus = ${union(cancellable)};

export type OperationStatusTone = ${toneUnion};

export declare const OPERATION_STATUSES: readonly OperationStatus[];

export declare const ACTIVE_STATUSES: readonly ActiveOperationStatus[];

export declare const TERMINAL_STATUSES: readonly TerminalOperationStatus[];

export declare const CANCELLABLE_STATUSES: readonly CancellableOperationStatus[];

export declare const OPERATION_STATUS_SET: ReadonlySet<OperationStatus>;

export declare const ACTIVE_STATUS_SET: ReadonlySet<OperationStatus>;

export declare const TERMINAL_STATUS_SET: ReadonlySet<OperationStatus>;

export declare const CANCELLABLE_STATUS_SET: ReadonlySet<OperationStatus>;

export declare const OPERATION_STATUS_LABELS: Readonly<Record<OperationStatus, string>>;

export declare const OPERATION_STATUS_TONES: Readonly<Record<OperationStatus, OperationStatusTone>>;
`;
}

function schemaAnnotation() {
  return {
    source: CATALOG_REL,
    generator: 'scripts/generate-async-operation-status-vocabulary.mjs',
    command: GENERATE_COMMAND
  };
}

function canonicalizeJson(object) {
  return `${JSON.stringify(object, null, 2)}\n`;
}

export function renderQueryResponseSchema(catalog, existingText) {
  const schema = JSON.parse(existingText);
  const node = schema?.definitions?.OperationStatus;
  if (!node || !Array.isArray(node.enum)) {
    throw new Error(`Managed pointer /definitions/OperationStatus/enum not found in ${QUERY_RESPONSE_REL}`);
  }
  node.enum = catalog.statuses.map((entry) => entry.value);
  schema[SCHEMA_ANNOTATION_KEY] = schemaAnnotation();
  return canonicalizeJson(schema);
}

export function renderStateChangedSchema(catalog, existingText) {
  const schema = JSON.parse(existingText);
  const previous = schema?.properties?.previousStatus;
  const next = schema?.properties?.newStatus;
  if (!previous || !Array.isArray(previous.enum)) {
    throw new Error(`Managed pointer /properties/previousStatus/enum not found in ${STATE_CHANGED_REL}`);
  }
  if (!next || !Array.isArray(next.enum)) {
    throw new Error(`Managed pointer /properties/newStatus/enum not found in ${STATE_CHANGED_REL}`);
  }
  const values = catalog.statuses.map((entry) => entry.value);
  previous.enum = values;
  next.enum = values;
  schema[SCHEMA_ANNOTATION_KEY] = schemaAnnotation();
  return canonicalizeJson(schema);
}

export function buildArtifacts(rootDir = REPO_ROOT) {
  const catalog = readCatalog(rootDir);
  validateCatalog(catalog);
  const queryText = fs.readFileSync(path.join(rootDir, QUERY_RESPONSE_REL), 'utf8');
  const stateText = fs.readFileSync(path.join(rootDir, STATE_CHANGED_REL), 'utf8');

  // Fixed path order — governs render order, comparison order, and report order.
  return [
    { relPath: BACKEND_REL, content: renderBackendModule(catalog) },
    { relPath: CONSOLE_REL, content: renderConsoleModule(catalog) },
    { relPath: CONSOLE_DTS_REL, content: renderConsoleDeclaration(catalog) },
    { relPath: QUERY_RESPONSE_REL, content: renderQueryResponseSchema(catalog, queryText) },
    { relPath: STATE_CHANGED_REL, content: renderStateChangedSchema(catalog, stateText) }
  ];
}

// ----------------------------------------------------------------------------- migration parity

export function stripSqlComments(sql) {
  return sql.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/--[^\n\r]*/g, '');
}

export function extractNamedInValues(sql, pattern, artifactName) {
  const matches = [...sql.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one executable ${artifactName} in migration 076, found ${matches.length}`);
  }
  return [...matches[0][1].matchAll(/'((?:''|[^'])*)'/g)].map((match) => match[1].replaceAll("''", "'"));
}

function arraysEqual(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => value === b[index]);
}

function setsEqual(a, b) {
  return arraysEqual([...a].sort(), [...b].sort());
}

export function checkMigrationParity(rootDir = REPO_ROOT, catalog = readCatalog(rootDir)) {
  const sql = stripSqlComments(fs.readFileSync(path.join(rootDir, MIGRATION_REL), 'utf8'));
  const constraintValues = extractNamedInValues(sql, CONSTRAINT_PATTERN, 'async_operations_status_check constraint');
  const indexValues = extractNamedInValues(sql, INDEX_PATTERN, 'idx_async_ops_status_updated partial index');
  const catalogValues = catalog.statuses.map((entry) => entry.value);
  const activeValues = catalog.statuses.filter((entry) => entry.active).map((entry) => entry.value);

  const problems = [];
  if (!arraysEqual(constraintValues, catalogValues)) {
    problems.push(
      `${MIGRATION_REL}: status constraint ${JSON.stringify(constraintValues)} does not match catalog order ${JSON.stringify(catalogValues)}`
    );
  }
  if (!setsEqual(indexValues, activeValues)) {
    problems.push(
      `${MIGRATION_REL}: active partial index ${JSON.stringify(indexValues)} does not match catalog active subset ${JSON.stringify(activeValues)}`
    );
  }
  return { problems, constraintValues, indexValues };
}

// ----------------------------------------------------------------------------- drift + orchestration

export function computeDrift(rootDir = REPO_ROOT, artifacts = buildArtifacts(rootDir)) {
  const missing = [];
  const stale = [];
  for (const artifact of artifacts) {
    const absolute = path.join(rootDir, artifact.relPath);
    if (!fs.existsSync(absolute)) {
      missing.push(artifact.relPath);
      continue;
    }
    if (fs.readFileSync(absolute, 'utf8') !== artifact.content) {
      stale.push(artifact.relPath);
    }
  }
  return { missing, stale };
}

export function runGeneration({ rootDir = REPO_ROOT, check = false } = {}) {
  const artifacts = buildArtifacts(rootDir);
  const { missing, stale } = computeDrift(rootDir, artifacts);
  const parity = checkMigrationParity(rootDir);
  const written = [];

  if (!check && parity.problems.length === 0) {
    for (const artifact of artifacts) {
      const absolute = path.join(rootDir, artifact.relPath);
      const current = fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : null;
      if (current !== artifact.content) {
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, artifact.content);
        written.push(artifact.relPath);
      }
    }
  }

  return {
    mode: check ? 'check' : 'write',
    missing,
    stale,
    written,
    parityProblems: parity.problems
  };
}

// ----------------------------------------------------------------------------- CLI

function main(argv) {
  const check = argv.includes('--check');
  let result;
  try {
    result = runGeneration({ check });
  } catch (error) {
    console.error(`async-operation status vocabulary generation failed:\n${error.message}`);
    process.exitCode = 1;
    return;
  }

  const failed = result.parityProblems.length > 0 || (check && (result.missing.length > 0 || result.stale.length > 0));

  for (const relPath of result.missing) console.error(`missing generated artifact: ${relPath}`);
  for (const relPath of result.stale) console.error(`stale generated artifact: ${relPath}`);
  for (const problem of result.parityProblems) console.error(`migration parity failure: ${problem}`);

  if (check) {
    if (failed) {
      console.error(`\nRun \`${GENERATE_COMMAND}\` and re-run \`${CHECK_COMMAND}\`. Do not hand-edit generated files.`);
      process.exitCode = 1;
    } else {
      console.log('async-operation status vocabulary: all generated artifacts and migration 076 parity are up to date.');
    }
    return;
  }

  if (result.written.length > 0) {
    for (const relPath of result.written) console.log(`generated: ${relPath}`);
  } else {
    console.log('async-operation status vocabulary: already up to date.');
  }
  if (failed) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2));
}

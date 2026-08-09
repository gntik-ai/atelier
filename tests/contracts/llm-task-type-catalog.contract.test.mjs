// add-llm-agent-flow-task (#640) — task-type catalog + gateway-route contract.
//
// Pins the cross-module contract: the Temporal-free descriptor catalog (consumed by the console
// palette + the validate endpoint's FLW-E006) agrees with the canonical name list and carries a
// well-formed llm.complete descriptor; and the APISIX gateway forwards the LLM subpaths to the
// executor (else they 404 NO_ROUTE on the control-plane).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildTaskTypeCatalog, TASK_TYPE_DESCRIPTORS } from '../../apps/control-plane-executor/src/runtime/flow-task-types.mjs';
import { TASK_TYPE_NAMES } from '../../apps/workflow-worker/src/activities/catalog-names.mjs';

test('ctr-llm-cat-01: llm.complete is present in both the canonical names and the descriptor catalog', () => {
  assert.ok(TASK_TYPE_NAMES.includes('llm.complete'), 'canonical name list includes llm.complete');
  assert.ok(TASK_TYPE_DESCRIPTORS.some((d) => d.id === 'llm.complete'), 'descriptor catalog includes llm.complete');
});

test('ctr-llm-cat-02: buildTaskTypeCatalog() holds its id-set invariant and emits a usable llm descriptor', () => {
  const catalog = buildTaskTypeCatalog(); // throws if descriptor ids drift from TASK_TYPE_NAMES
  const llm = catalog.find((d) => d.id === 'llm.complete');
  assert.ok(llm, 'catalog lists llm.complete');
  assert.equal(llm.category, 'ai');
  assert.equal(llm.inputSchema.type, 'object');
  assert.deepEqual(llm.inputSchema.required, ['model']);
  assert.equal(typeof llm.inputSchema.properties.messages, 'object');
});

test('ctr-llm-cat-03: APISIX routes the LLM subpaths to the executor', () => {
  const src = readFileSync(fileURLToPath(new URL('../../deploy/kind/apisix/apisix.yaml', import.meta.url)), 'utf8');
  const idx = src.indexOf('2003-llm');
  assert.ok(idx > -1, 'a dedicated 2003-llm route exists in apisix.yaml');
  const nextRoute = src.indexOf('\n  - id:', idx);
  const block = src.slice(idx, nextRoute === -1 ? undefined : nextRoute);
  assert.match(block, /llm-provider\|llm\/completions\|llm-usage/, 'route matches the three LLM subpaths');
  assert.match(block, /falcone-control-plane-executor/, 'route forwards to the executor, not the control-plane');
});

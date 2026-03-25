import test from 'node:test';
import assert from 'node:assert/strict';

import { collectTestingStrategyViolations, readReferenceDataset, readTestingStrategy } from '../../scripts/lib/testing-strategy.mjs';
import { OPENAPI_PATH, readJson } from '../../scripts/lib/quality-gates.mjs';

test('testing strategy API expectations stay aligned with the control-plane OpenAPI contract', () => {
  const strategy = readTestingStrategy();
  const dataset = readReferenceDataset();
  const openapi = readJson(OPENAPI_PATH);
  const violations = collectTestingStrategyViolations(strategy, dataset, openapi);

  assert.deepEqual(violations, []);
  assert.equal(strategy.api_contract.uri_prefix, '/v1/');
  assert.equal(strategy.api_contract.version_header.name, 'X-API-Version');
  assert.equal(strategy.api_contract.version_header.current_value, '2026-03-25');
  assert.equal(
    strategy.cross_domain_matrix.scenarios.some((scenario) => scenario.id === 'AC-SEC-002'),
    true
  );
  assert.equal(
    strategy.cross_domain_matrix.scenarios.some((scenario) => scenario.id === 'RS-SEC-002'),
    true
  );
});

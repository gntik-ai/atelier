import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectDomainModelViolations,
  readDomainModel,
  readDomainSeedFixtures
} from '../../scripts/lib/domain-model.mjs';
import {
  DOMAIN_MODEL_VERSION,
  getDomainEntity,
  listDomainEntities,
  listLifecycleEvents,
  listLifecycleTransitions
} from '../../services/internal-contracts/src/index.mjs';

test('domain model remains internally consistent', () => {
  const domainModel = readDomainModel();
  const seedFixtures = readDomainSeedFixtures();
  const violations = collectDomainModelViolations(domainModel, seedFixtures);

  assert.deepEqual(violations, []);
  assert.equal(DOMAIN_MODEL_VERSION, '2026-03-23');
  assert.deepEqual(
    listDomainEntities().map((entity) => entity.id),
    ['platform_user', 'tenant', 'workspace', 'external_application', 'service_account', 'managed_resource']
  );
  assert.deepEqual(listLifecycleTransitions().map((transition) => transition.id), ['create', 'activate', 'suspend', 'soft_delete']);
  assert.equal(listLifecycleEvents().length, 24);
});

test('managed resource kinds and seed fixture profiles preserve downstream reuse guarantees', () => {
  const managedResource = getDomainEntity('managed_resource');
  const seedFixtures = readDomainSeedFixtures();
  const profileIds = seedFixtures.profiles.map((profile) => profile.id);

  assert.deepEqual(managedResource.supported_kinds, ['database', 'bucket', 'topic', 'function']);
  assert.deepEqual(profileIds, ['starter-single-workspace', 'growth-multi-workspace', 'enterprise-dedicated']);
  assert.equal(seedFixtures.profiles.find((profile) => profile.id === 'starter-single-workspace').workspace_count, 1);
  assert.equal(seedFixtures.profiles.find((profile) => profile.id === 'enterprise-dedicated').tenant.placement, 'dedicated_database');
  assert.equal(
    seedFixtures.profiles.find((profile) => profile.id === 'growth-multi-workspace').managedResources.some(
      (resource) => resource.kind === 'function'
    ),
    true
  );
});

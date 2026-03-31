import * as planRepository from '../../../../services/provisioning-orchestrator/src/repositories/plan-repository.mjs';

export async function setup(pgClient, actorId = 'seed-superadmin') {
  const created = [];
  created.push(await planRepository.create(pgClient, { slug: 'test-starter', displayName: 'Starter', status: 'draft', createdBy: actorId, updatedBy: actorId }));
  created.push(await planRepository.create(pgClient, { slug: 'test-professional', displayName: 'Professional', status: 'active', createdBy: actorId, updatedBy: actorId }));
  created.push(await planRepository.create(pgClient, { slug: 'test-enterprise', displayName: 'Enterprise', status: 'deprecated', createdBy: actorId, updatedBy: actorId }));
  return created;
}

export async function teardown(pgClient) {
  await pgClient.query("DELETE FROM plans WHERE slug IN ('test-starter','test-professional','test-enterprise')");
}

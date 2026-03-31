import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
const { Client } = pg;
import fs from 'node:fs/promises';
import { main as createPlan } from '../../../services/provisioning-orchestrator/src/actions/plan-create.mjs';
import { main as lifecyclePlan } from '../../../services/provisioning-orchestrator/src/actions/plan-lifecycle.mjs';
import { main as assignPlan } from '../../../services/provisioning-orchestrator/src/actions/plan-assign.mjs';
import { main as getAssignment } from '../../../services/provisioning-orchestrator/src/actions/plan-assignment-get.mjs';
import { setup as setupTenant } from './fixtures/create-test-tenant.mjs';

const migration = await fs.readFile(new URL('../../../services/provisioning-orchestrator/src/migrations/097-plan-entity-tenant-assignment.sql', import.meta.url), 'utf8');
const superadmin = { callerContext: { actor: { id: 'superadmin-1', type: 'superadmin' } } };
const producer = { send: async () => {} };
async function db() { const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect(); await client.query(migration); await client.query('TRUNCATE tenant_plan_assignments, plan_audit_events, plans RESTART IDENTITY CASCADE'); await client.query('DROP TABLE IF EXISTS tenants'); return client; }

test('tenant isolation on current assignment reads', async () => {
  if (!process.env.DATABASE_URL) return test.skip('DATABASE_URL not set');
  const client = await db();
  try {
    await setupTenant(client, 'tenant-1');
    await setupTenant(client, 'tenant-2');
    const created = await createPlan({ ...superadmin, db: client, producer, slug: 'iso-plan', displayName: 'Iso' });
    await lifecyclePlan({ ...superadmin, db: client, producer, planId: created.body.id, targetStatus: 'active' });
    await assignPlan({ ...superadmin, db: client, producer, tenantId: 'tenant-1', planId: created.body.id, assignedBy: 'superadmin-1' });
    const own = await getAssignment({ db: client, tenantId: 'tenant-1', callerContext: { actor: { id: 'owner-1', type: 'tenant-owner' }, tenantId: 'tenant-1' } });
    assert.equal(own.body.plan.slug, 'iso-plan');
    await assert.rejects(() => getAssignment({ db: client, tenantId: 'tenant-1', callerContext: { actor: { id: 'owner-2', type: 'tenant-owner' }, tenantId: 'tenant-2' } }), { code: 'FORBIDDEN' });
  } finally { await client.end(); }
});

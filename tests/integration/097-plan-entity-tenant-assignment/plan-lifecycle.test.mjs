import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
const { Client } = pg;
import fs from 'node:fs/promises';
import { main as createPlan } from '../../../services/provisioning-orchestrator/src/actions/plan-create.mjs';
import { main as lifecyclePlan } from '../../../services/provisioning-orchestrator/src/actions/plan-lifecycle.mjs';
import { main as assignPlan } from '../../../services/provisioning-orchestrator/src/actions/plan-assign.mjs';
import { setup as setupTenant } from './fixtures/create-test-tenant.mjs';

const migration = await fs.readFile(new URL('../../../services/provisioning-orchestrator/src/migrations/097-plan-entity-tenant-assignment.sql', import.meta.url), 'utf8');
const superadmin = { callerContext: { actor: { id: 'superadmin-1', type: 'superadmin' } } };
const producer = { send: async () => {} };
async function db() { const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect(); await client.query(migration); await client.query('TRUNCATE tenant_plan_assignments, plan_audit_events, plans RESTART IDENTITY CASCADE'); await client.query('DROP TABLE IF EXISTS tenants'); return client; }

test('lifecycle traversal and archive guard', async () => {
  if (!process.env.DATABASE_URL) return test.skip('DATABASE_URL not set');
  const client = await db();
  try {
    await setupTenant(client, 'tenant-life');
    const created = await createPlan({ ...superadmin, db: client, producer, slug: 'plan-life', displayName: 'Lifecycle' });
    await lifecyclePlan({ ...superadmin, db: client, producer, planId: created.body.id, targetStatus: 'active' });
    await assignPlan({ ...superadmin, db: client, producer, tenantId: 'tenant-life', planId: created.body.id, assignedBy: 'superadmin-1' });
    await assert.rejects(() => lifecyclePlan({ ...superadmin, db: client, producer, planId: created.body.id, targetStatus: 'archived' }), { code: 'PLAN_HAS_ACTIVE_ASSIGNMENTS' });
    await lifecyclePlan({ ...superadmin, db: client, producer, planId: created.body.id, targetStatus: 'deprecated' });
    await assert.rejects(() => lifecyclePlan({ ...superadmin, db: client, producer, planId: created.body.id, targetStatus: 'active' }), { code: 'INVALID_TRANSITION' });
  } finally { await client.end(); }
});

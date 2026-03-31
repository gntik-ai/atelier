import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
const { Client } = pg;
import fs from 'node:fs/promises';
import { main as createPlan } from '../../../services/provisioning-orchestrator/src/actions/plan-create.mjs';
import { main as lifecyclePlan } from '../../../services/provisioning-orchestrator/src/actions/plan-lifecycle.mjs';
import { main as assignPlan } from '../../../services/provisioning-orchestrator/src/actions/plan-assign.mjs';
import { main as assignmentHistory } from '../../../services/provisioning-orchestrator/src/actions/plan-assignment-history.mjs';
import { setup as setupTenant } from './fixtures/create-test-tenant.mjs';

const migration = await fs.readFile(new URL('../../../services/provisioning-orchestrator/src/migrations/097-plan-entity-tenant-assignment.sql', import.meta.url), 'utf8');
const superadmin = { callerContext: { actor: { id: 'superadmin-1', type: 'superadmin' } } };
const producer = { send: async () => {} };
async function db() { const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect(); await client.query(migration); await client.query('TRUNCATE tenant_plan_assignments, plan_audit_events, plans RESTART IDENTITY CASCADE'); await client.query('DROP TABLE IF EXISTS tenants'); return client; }
async function createActive(client, slug) { const created = await createPlan({ ...superadmin, db: client, producer, slug, displayName: slug }); await lifecyclePlan({ ...superadmin, db: client, producer, planId: created.body.id, targetStatus: 'active' }); return created.body; }

test('assignment, reassignment, and history', async () => {
  if (!process.env.DATABASE_URL) return test.skip('DATABASE_URL not set');
  const client = await db();
  try {
    await setupTenant(client, 'tenant-a');
    const p1 = await createActive(client, 'plan-a');
    const p2 = await createActive(client, 'plan-b');
    const first = await assignPlan({ ...superadmin, db: client, producer, tenantId: 'tenant-a', planId: p1.id, assignedBy: 'superadmin-1' });
    const second = await assignPlan({ ...superadmin, db: client, producer, tenantId: 'tenant-a', planId: p2.id, assignedBy: 'superadmin-1' });
    assert.equal(first.body.previousPlanId, null);
    assert.equal(second.body.previousPlanId, p1.id);
    const history = await assignmentHistory({ ...superadmin, db: client, tenantId: 'tenant-a' });
    assert.equal(history.body.total, 2);
    assert.equal(history.body.assignments[0].planId, p2.id);
    const audit = await client.query("SELECT action_type FROM plan_audit_events WHERE tenant_id = 'tenant-a' ORDER BY created_at");
    assert.deepEqual(audit.rows.map((r) => r.action_type), ['assignment.created', 'assignment.superseded', 'assignment.created']);
  } finally { await client.end(); }
});

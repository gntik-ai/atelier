import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
const { Client } = pg;
import fs from 'node:fs/promises';
import { main as createPlan } from '../../../services/provisioning-orchestrator/src/actions/plan-create.mjs';
import { main as updatePlan } from '../../../services/provisioning-orchestrator/src/actions/plan-update.mjs';
import { main as lifecyclePlan } from '../../../services/provisioning-orchestrator/src/actions/plan-lifecycle.mjs';

const migration = await fs.readFile(new URL('../../../services/provisioning-orchestrator/src/migrations/097-plan-entity-tenant-assignment.sql', import.meta.url), 'utf8');
const superadmin = { callerContext: { actor: { id: 'superadmin-1', type: 'superadmin' } } };
const sent = [];
const producer = { send: async (payload) => sent.push(payload) };
async function db() { const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect(); await client.query(migration); await client.query('TRUNCATE tenant_plan_assignments, plan_audit_events, plans RESTART IDENTITY CASCADE'); return client; }

test('audit rows and kafka payloads are emitted', async () => {
  if (!process.env.DATABASE_URL) return test.skip('DATABASE_URL not set');
  const client = await db();
  try {
    const created = await createPlan({ ...superadmin, db: client, producer, slug: 'audit-plan', displayName: 'Audit' });
    await updatePlan({ ...superadmin, db: client, producer, planId: created.body.id, description: 'desc' });
    await lifecyclePlan({ ...superadmin, db: client, producer, planId: created.body.id, targetStatus: 'active' });
    const audit = await client.query('SELECT action_type, actor_id FROM plan_audit_events ORDER BY created_at');
    assert.deepEqual(audit.rows.map((r) => r.action_type), ['plan.created', 'plan.updated', 'plan.lifecycle_transitioned']);
    assert.ok(sent.length >= 3);
  } finally { await client.end(); }
});

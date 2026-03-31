function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createFakeProducer() {
  return {
    messages: [],
    async send(payload) {
      this.messages.push(payload);
    }
  };
}

export function createFakeDb() {
  return {
    catalog: new Map(),
    plans: new Map(),
    assignments: new Map(),
    auditEvents: [],
    async query(sql, params = []) {
      const text = `${sql}`.trim().replace(/\s+/g, ' ');

      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (text.startsWith('SET LOCAL lock_timeout')) return { rows: [] };

      if (text.includes('FROM quota_dimension_catalog') && text.includes('ORDER BY dimension_key ASC')) {
        return { rows: [...this.catalog.values()].sort((a, b) => a.dimension_key.localeCompare(b.dimension_key)).map(deepClone) };
      }

      if (text.includes('FROM quota_dimension_catalog') && text.includes('WHERE dimension_key = $1')) {
        return { rows: this.catalog.has(params[0]) ? [deepClone(this.catalog.get(params[0]))] : [] };
      }

      if (text.includes('SELECT id, status, slug, quota_dimensions FROM plans WHERE id = $1 FOR UPDATE') || text.includes('SELECT id, status, slug, quota_dimensions FROM plans WHERE id = $1')) {
        const plan = this.plans.get(params[0]);
        return { rows: plan ? [deepClone(plan)] : [] };
      }

      if (text.startsWith('UPDATE plans SET quota_dimensions = COALESCE(quota_dimensions,') && text.includes('jsonb_build_object')) {
        const plan = this.plans.get(params[0]);
        plan.quota_dimensions[params[1]] = params[2];
        return { rows: [deepClone(plan)] };
      }

      if (text.startsWith('UPDATE plans SET quota_dimensions = COALESCE(quota_dimensions,') && text.includes('- $2::text')) {
        const plan = this.plans.get(params[0]);
        delete plan.quota_dimensions[params[1]];
        return { rows: [deepClone(plan)] };
      }

      if (text.startsWith('INSERT INTO plan_audit_events')) {
        this.auditEvents.push({
          action_type: params[0],
          actor_id: params[1],
          tenant_id: params[2],
          plan_id: params[3],
          previous_state: JSON.parse(params[4]),
          new_state: JSON.parse(params[5]),
          correlation_id: params[6]
        });
        return { rows: [] };
      }

      if (text === 'SELECT quota_dimensions FROM plans WHERE id = $1') {
        const plan = this.plans.get(params[0]);
        return { rows: plan ? [{ quota_dimensions: deepClone(plan.quota_dimensions) }] : [] };
      }

      if (text.includes('FROM tenant_plan_assignments tpa JOIN plans p ON p.id = tpa.plan_id')) {
        const assignment = this.assignments.get(params[0]);
        if (!assignment || assignment.supersededAt) return { rows: [] };
        const plan = this.plans.get(assignment.planId);
        return { rows: [{ plan_id: plan.id, plan_slug: plan.slug, plan_status: plan.status, quota_dimensions: deepClone(plan.quota_dimensions) }] };
      }

      throw new Error(`Unhandled fake SQL: ${text}`);
    }
  };
}

export async function seedPlans(pgClient) {
  pgClient.plans = new Map([
    ['plan-draft', { id: 'plan-draft', slug: 'starter-draft', status: 'draft', quota_dimensions: {} }],
    ['plan-active', { id: 'plan-active', slug: 'starter-active', status: 'active', quota_dimensions: {} }],
    ['plan-deprecated', { id: 'plan-deprecated', slug: 'starter-deprecated', status: 'deprecated', quota_dimensions: {} }],
    ['plan-archived', { id: 'plan-archived', slug: 'starter-archived', status: 'archived', quota_dimensions: {} }]
  ]);
  pgClient.assignments = new Map([
    ['tenant-a', { tenantId: 'tenant-a', planId: 'plan-active', supersededAt: null }],
    ['tenant-b', { tenantId: 'tenant-b', planId: 'plan-draft', supersededAt: null }]
  ]);
  pgClient.auditEvents = [];
  return {
    draftPlan: pgClient.plans.get('plan-draft'),
    activePlan: pgClient.plans.get('plan-active'),
    deprecatedPlan: pgClient.plans.get('plan-deprecated'),
    archivedPlan: pgClient.plans.get('plan-archived'),
    testTenantId: 'tenant-a'
  };
}

export async function cleanupPlans(pgClient) {
  pgClient.plans?.clear();
  pgClient.assignments?.clear();
  pgClient.auditEvents = [];
}

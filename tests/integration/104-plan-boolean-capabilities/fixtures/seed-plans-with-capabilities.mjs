export function seedPlans(db) {
  db.plans.set('plan-draft', { id: 'plan-draft', status: 'draft', slug: 'draft', display_name: 'Draft', capabilities: {} });
  db.plans.set('plan-active-basic', { id: 'plan-active-basic', status: 'active', slug: 'basic', display_name: 'Basic', capabilities: { webhooks: true } });
  db.plans.set('plan-active-full', { id: 'plan-active-full', status: 'active', slug: 'professional', display_name: 'Professional', capabilities: { sql_admin_api: true, realtime: true, webhooks: true, public_functions: true } });
  db.plans.set('plan-deprecated', { id: 'plan-deprecated', status: 'deprecated', slug: 'deprecated', display_name: 'Deprecated', capabilities: { realtime: true } });
  db.plans.set('plan-archived', { id: 'plan-archived', status: 'archived', slug: 'archived', display_name: 'Archived', capabilities: {} });
  db.plans.set('plan-with-orphan', { id: 'plan-with-orphan', status: 'active', slug: 'orphan', display_name: 'Orphan', capabilities: { realtime: true, legacy_feature: true } });
}

export function seedAssignments(db) {
  db.assignments.set('tenant-basic', { tenant_id: 'tenant-basic', plan_id: 'plan-active-basic' });
  db.assignments.set('tenant-full', { tenant_id: 'tenant-full', plan_id: 'plan-active-full' });
}

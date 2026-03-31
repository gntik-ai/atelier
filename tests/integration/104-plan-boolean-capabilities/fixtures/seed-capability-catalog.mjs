export const CATALOG_SEED = [
  { capability_key: 'sql_admin_api', display_label: 'SQL Admin API', description: "Enables direct SQL admin access to the tenant's PostgreSQL databases", platform_default: false, is_active: true, sort_order: 10 },
  { capability_key: 'passthrough_admin', display_label: 'Passthrough Admin Proxy', description: 'Enables the passthrough admin proxy for direct database management', platform_default: false, is_active: true, sort_order: 20 },
  { capability_key: 'realtime', display_label: 'Realtime Subscriptions', description: 'Enables WebSocket-based realtime subscription channels', platform_default: false, is_active: true, sort_order: 30 },
  { capability_key: 'webhooks', display_label: 'Outbound Webhooks', description: 'Enables outbound webhook delivery for event notifications', platform_default: false, is_active: true, sort_order: 40 },
  { capability_key: 'public_functions', display_label: 'Public Serverless Functions', description: 'Enables public HTTP endpoints for serverless functions', platform_default: false, is_active: true, sort_order: 50 },
  { capability_key: 'custom_domains', display_label: 'Custom Domains', description: 'Enables custom domain configuration for tenant endpoints', platform_default: false, is_active: true, sort_order: 60 },
  { capability_key: 'scheduled_functions', display_label: 'Scheduled Functions', description: 'Enables cron-scheduled execution of serverless functions', platform_default: false, is_active: true, sort_order: 70 }
];

export function createFakeProducer() { return { messages: [], async send(payload) { this.messages.push(payload); } }; }

export function createFakeDb() {
  const db = {
    _boolCatalog: [...CATALOG_SEED],
    plans: new Map(),
    assignments: new Map(),
    _planAuditEvents: [],
    async query(sql, params = []) {
      if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK') || sql.startsWith('SET LOCAL')) return { rows: [] };
      if (sql.includes('FROM boolean_capability_catalog') && sql.includes('WHERE is_active = true') && sql.includes('ORDER BY sort_order')) return { rows: this._boolCatalog.filter((row) => row.is_active) };
      if (sql.includes('FROM boolean_capability_catalog') && sql.includes('ORDER BY sort_order') && !sql.includes('WHERE is_active = true')) return { rows: this._boolCatalog };
      if (sql.includes('FROM boolean_capability_catalog') && sql.includes('WHERE capability_key = $1')) return { rows: this._boolCatalog.filter((row) => row.capability_key === params[0]) };
      if (sql.startsWith('SELECT id, status, slug, display_name, capabilities FROM plans WHERE id = $1')) {
        const plan = this.plans.get(params[0]);
        return { rows: plan ? [plan] : [] };
      }
      if (sql.startsWith('UPDATE plans SET capabilities')) {
        const plan = this.plans.get(params[0]);
        plan.capabilities = JSON.parse(params[1]);
        plan.updated_by = params[2];
        return { rows: [plan] };
      }
      if (sql.startsWith('INSERT INTO plan_audit_events')) {
        const event = { event_id: `evt-${this._planAuditEvents.length + 1}`, action_type: params[0], actor_id: params[1], tenant_id: params[2], plan_id: params[3], previous_state: JSON.parse(params[4]), new_state: JSON.parse(params[5]), correlation_id: params[6], created_at: new Date(Date.now() + this._planAuditEvents.length).toISOString() };
        this._planAuditEvents.push(event);
        return { rows: [] };
      }
      if (sql.includes('FROM plan_audit_events') && sql.includes('COUNT(*)::int AS total')) {
        const rows = this._planAuditEvents.filter((event) => ['plan.capability.enabled', 'plan.capability.disabled'].includes(event.action_type)).filter((event) => !params[0] || event.plan_id === params[0]).filter((event) => !params[1] || event.previous_state.capabilityKey === params[1] || event.new_state.capabilityKey === params[1]).filter((event) => !params[2] || event.actor_id === params[2]).filter((event) => !params[3] || event.created_at >= params[3]).filter((event) => !params[4] || event.created_at <= params[4]);
        return { rows: [{ total: rows.length }] };
      }
      if (sql.includes('FROM plan_audit_events') && sql.includes("action_type IN ('plan.capability.enabled', 'plan.capability.disabled')")) {
        const rows = this._planAuditEvents.filter((event) => ['plan.capability.enabled', 'plan.capability.disabled'].includes(event.action_type)).filter((event) => !params[0] || event.plan_id === params[0]).filter((event) => !params[1] || event.previous_state.capabilityKey === params[1] || event.new_state.capabilityKey === params[1]).filter((event) => !params[2] || event.actor_id === params[2]).filter((event) => !params[3] || event.created_at >= params[3]).filter((event) => !params[4] || event.created_at <= params[4]).slice(params[6] ?? 0, (params[6] ?? 0) + (params[5] ?? 50));
        return { rows };
      }
      if (sql.includes('FROM tenant_plan_assignments')) {
        const assignment = this.assignments.get(params[0]);
        if (!assignment) return { rows: [] };
        const plan = this.plans.get(assignment.plan_id);
        if (sql.includes('JOIN plans')) {
          return { rows: [{ plan_id: plan.id, plan_slug: plan.slug, plan_status: plan.status, capabilities: plan.capabilities ?? {} }] };
        }
        return { rows: [{ tenant_id: assignment.tenant_id, plan_id: assignment.plan_id, effective_from: assignment.effective_from ?? '2026-03-31T00:00:00.000Z' }] };
      }
      throw new Error(`Unhandled SQL: ${sql}`);
    }
  };
  return db;
}

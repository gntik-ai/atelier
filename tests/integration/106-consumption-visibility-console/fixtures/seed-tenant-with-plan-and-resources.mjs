import { createFakeDb, seedAssignments, seedPlans } from '../../105-effective-limit-resolution/fixtures/seed-plans-with-quotas-and-capabilities.mjs';

export function seedTenantWithPlanAndResources() {
  const db = createFakeDb();
  seedPlans(db);
  seedAssignments(db);
  db.catalogDimensions.push(
    { dimension_key: 'max_realtime_channels', display_label: 'Maximum Realtime Channels', unit: 'count', default_value: 10, sort_order: 50 },
    { dimension_key: 'max_storage_gb', display_label: 'Maximum Storage', unit: 'gb', default_value: 5, sort_order: 60 },
    { dimension_key: 'max_monthly_api_calls', display_label: 'Monthly API Calls', unit: 'count', default_value: 1000, sort_order: 70 },
    { dimension_key: 'max_members', display_label: 'Members', unit: 'count', default_value: 20, sort_order: 80 }
  );
  db.workspaces = [{ tenantId: 'pro-corp', workspaceId: 'ws-1' }, { tenantId: 'pro-corp', workspaceId: 'ws-2' }, { tenantId: 'pro-corp', workspaceId: 'ws-3' }];
  db.pg_databases = Array.from({ length: 9 }, (_, index) => ({ tenantId: 'pro-corp', workspaceId: index < 4 ? 'ws-prod' : 'ws-dev' }));
  db.functions = Array.from({ length: 15 }, () => ({ tenantId: 'acme-corp', workspaceId: 'ws-fn' }));
  db.kafka_topics = Array.from({ length: 2 }, () => ({ tenantId: 'pro-corp', workspaceId: 'ws-prod' }));
  db.realtime_channels = Array.from({ length: 4 }, () => ({ tenantId: 'pro-corp', workspaceId: 'ws-prod' }));
  db.storage_objects = [{ tenantId: 'pro-corp', workspaceId: 'ws-prod', sizeBytes: 1_500_000_000 }];
  db.api_call_logs = Array.from({ length: 23 }, () => ({ tenantId: 'pro-corp', workspaceId: 'ws-prod', createdAt: new Date().toISOString() }));
  db.workspace_members = Array.from({ length: 11 }, () => ({ tenantId: 'pro-corp', workspaceId: 'ws-prod' }));
  return db;
}

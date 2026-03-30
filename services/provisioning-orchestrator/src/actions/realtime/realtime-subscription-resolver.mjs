import { SubscriptionRepository } from '../../repositories/realtime/SubscriptionRepository.mjs';
import { matches } from '../../models/realtime/EventFilter.mjs';

export async function resolveRealtimeSubscriptions(params, { db } = {}) {
  const repository = new SubscriptionRepository(db);
  const listed = await repository.list(params.tenantId, params.workspaceId, { status: 'active' }, 1, 1000);
  const items = listed.items.filter((item) => item.channel_type === params.channelType).filter((item) => matches(item.event_filter, { tableName: params.tableName, collectionName: params.collectionName, schemaName: params.schemaName, operation: params.operation })).map((item) => ({ id: item.id, owner_identity: item.owner_identity, event_filter: item.event_filter, metadata: item.metadata }));
  return { statusCode: 200, body: { items, total: items.length } };
}

export default async function main(params, deps = {}) {
  return resolveRealtimeSubscriptions(params, deps);
}

import { validate as validateEventFilter } from '../../models/realtime/EventFilter.mjs';
import { Subscription } from '../../models/realtime/Subscription.mjs';
import { ChannelRepository } from '../../repositories/realtime/ChannelRepository.mjs';
import { SubscriptionRepository } from '../../repositories/realtime/SubscriptionRepository.mjs';
import { QuotaRepository } from '../../repositories/realtime/QuotaRepository.mjs';
import { AuditRepository } from '../../repositories/realtime/AuditRepository.mjs';
import { SubscriptionLifecyclePublisher } from '../../events/realtime/SubscriptionLifecyclePublisher.mjs';

const badRequest = (code, message) => ({ statusCode: 400, body: { error: code, message } });
const conflict = (code, message) => ({ statusCode: 409, body: { error: code, message } });
const notFound = () => ({ statusCode: 404, body: { error: 'SUBSCRIPTION_NOT_FOUND' } });

export async function handleRealtimeSubscriptionCrud(params, deps = {}) {
  const { db, producer } = deps;
  const method = (params.method ?? 'GET').toUpperCase();
  const tenantId = params.tenantId;
  const workspaceId = params.workspaceId;
  const actorIdentity = params.actorIdentity ?? 'anonymous';
  const requestId = params.requestId ?? null;
  const channelRepo = new ChannelRepository(db);
  const subscriptionRepo = new SubscriptionRepository(db);
  const quotaRepo = new QuotaRepository(db);
  const auditRepo = new AuditRepository(db);
  const publisher = new SubscriptionLifecyclePublisher({ producer });

  if (method === 'GET' && params.tenantSummary === true) {
    const summary = await subscriptionRepo.findTenantSummary(tenantId, Number(params.page ?? 1), Number(params.pageSize ?? 50));
    return { statusCode: 200, body: summary };
  }

  if (method === 'GET' && params.subscriptionId) {
    const item = await subscriptionRepo.findById(tenantId, workspaceId, params.subscriptionId);
    return item ? { statusCode: 200, body: item.toJSON() } : notFound();
  }

  if (method === 'GET') {
    return { statusCode: 200, body: await subscriptionRepo.list(tenantId, workspaceId, { status: params.status ?? null }, Number(params.page ?? 1), Number(params.pageSize ?? 50)) };
  }

  if (method === 'POST') {
    const channel = await channelRepo.findByTypeAndRef(tenantId, workspaceId, params.channel_type, params.data_source_ref);
    if (!channel || channel.status !== 'available') return badRequest('INVALID_CHANNEL_TYPE', 'Channel type not available in workspace');
    const validation = validateEventFilter(params.event_filter ?? null);
    if (!validation.valid) return badRequest('INVALID_EVENT_FILTER', validation.errors.join(','));
    const created = await quotaRepo.atomicInsertWithQuotaCheck(tenantId, workspaceId, { tenant_id: tenantId, workspace_id: workspaceId, channel_id: channel.id, channel_type: channel.channel_type, owner_identity: actorIdentity, owner_client_id: params.owner_client_id ?? null, event_filter: params.event_filter ?? null, status: 'active', metadata: params.metadata ?? null });
    if (!created) return conflict('QUOTA_EXCEEDED', 'Subscription quota exceeded');
    await auditRepo.append({ subscription_id: created.id, tenant_id: tenantId, workspace_id: workspaceId, actor_identity: actorIdentity, action: 'created', before_state: null, after_state: created.toJSON(), request_id: requestId });
    await publisher.publish({ action: 'created', tenantId, workspaceId, actorIdentity, requestId, subscription: created, beforeState: null, afterState: created.toJSON() });
    return { statusCode: 201, body: created.toJSON() };
  }

  if (method === 'PATCH') {
    const current = await subscriptionRepo.findById(tenantId, workspaceId, params.subscriptionId);
    if (!current) return notFound();
    const action = params.status === 'suspended' ? 'suspend' : params.status === 'active' ? 'reactivate' : 'update';
    let next;
    try {
      next = new Subscription(current.toJSON()).transition(action, { event_filter: params.event_filter ?? current.event_filter, metadata: params.metadata ?? current.metadata });
    } catch {
      return conflict('INVALID_STATUS_TRANSITION', 'Illegal transition');
    }
    const updated = await subscriptionRepo.update(tenantId, workspaceId, params.subscriptionId, { status: next.status, event_filter: next.event_filter, metadata: next.metadata, deleted_at: next.deleted_at });
    await auditRepo.append({ subscription_id: updated.id, tenant_id: tenantId, workspace_id: workspaceId, actor_identity: actorIdentity, action: action === 'reactivate' ? 'reactivated' : action === 'suspend' ? 'suspended' : 'updated', before_state: current.toJSON(), after_state: updated.toJSON(), request_id: requestId });
    await publisher.publish({ action: action === 'reactivate' ? 'reactivated' : action === 'suspend' ? 'suspended' : 'updated', tenantId, workspaceId, actorIdentity, requestId, subscription: updated, beforeState: current.toJSON(), afterState: updated.toJSON() });
    return { statusCode: 200, body: updated.toJSON() };
  }

  if (method === 'DELETE') {
    const current = await subscriptionRepo.findById(tenantId, workspaceId, params.subscriptionId);
    if (!current) return notFound();
    const next = new Subscription(current.toJSON()).transition('delete');
    const deleted = await subscriptionRepo.update(tenantId, workspaceId, params.subscriptionId, { status: 'deleted', deleted_at: next.deleted_at });
    await auditRepo.append({ subscription_id: deleted.id, tenant_id: tenantId, workspace_id: workspaceId, actor_identity: actorIdentity, action: 'deleted', before_state: current.toJSON(), after_state: null, request_id: requestId });
    await publisher.publish({ action: 'deleted', tenantId, workspaceId, actorIdentity, requestId, subscription: deleted, beforeState: current.toJSON(), afterState: null });
    return { statusCode: 204, body: null };
  }

  return badRequest('UNSUPPORTED_METHOD', `Unsupported method ${method}`);
}

export default async function main(params, deps = {}) {
  return handleRealtimeSubscriptionCrud(params, deps);
}

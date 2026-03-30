import { findByOperationId, updateLastNotificationAt } from '../repositories/manual-intervention-flag-repo.mjs';
import { findByIdAnyTenant } from '../repositories/async-operation-repo.mjs';
import { shouldDebounceNotification } from '../models/manual-intervention-flag.mjs';
import { publishInterventionNotificationEvent } from '../events/async-operation-events.mjs';

function resolveDebounceMinutes(value = process.env.INTERVENTION_NOTIFICATION_DEBOUNCE_MINUTES) { const parsed = Number.parseInt(value ?? '15', 10); return Number.isInteger(parsed) && parsed >= 0 ? parsed : 15; }
export function buildInterventionNotifyDependencies(overrides = {}) {
  return {
    db: overrides.db,
    findByOperationId: overrides.findByOperationId ?? findByOperationId,
    findByIdAnyTenant: overrides.findByIdAnyTenant ?? findByIdAnyTenant,
    updateLastNotificationAt: overrides.updateLastNotificationAt ?? updateLastNotificationAt,
    publishInterventionNotificationEvent: overrides.publishInterventionNotificationEvent ?? publishInterventionNotificationEvent,
    resolveSuperadminId: overrides.resolveSuperadminId ?? ((tenantId) => `superadmin:${tenantId}`),
    log: overrides.log ?? console.log
  };
}

export async function main(params = {}, overrides = {}) {
  const dependencies = buildInterventionNotifyDependencies(overrides);
  const flag = await dependencies.findByOperationId(dependencies.db, params.operationId ?? params.operation_id);
  if (!flag) return { statusCode: 404, body: { error: 'FLAG_NOT_FOUND' } };
  if (shouldDebounceNotification(flag, resolveDebounceMinutes())) {
    dependencies.log(JSON.stringify({ level: 'warn', event: 'async_operation_intervention_notification_debounced', operation_id: flag.operation_id, tenant_id: flag.tenant_id }));
    return { statusCode: 202, body: { debounced: true } };
  }
  const operation = await dependencies.findByIdAnyTenant(dependencies.db, { operation_id: flag.operation_id });
  const timestamp = new Date().toISOString();
  await dependencies.updateLastNotificationAt(dependencies.db, flag.flag_id, timestamp);
  const recipients = [
    { recipientActorId: flag.actor_id, recipientRole: 'tenant_owner' },
    { recipientActorId: dependencies.resolveSuperadminId(flag.tenant_id), recipientRole: 'superadmin' }
  ].filter((entry) => entry.recipientActorId);
  for (const recipient of recipients) {
    await dependencies.publishInterventionNotificationEvent(params.producer ?? overrides.producer, { operationId: flag.operation_id, flagId: flag.flag_id, tenantId: flag.tenant_id, recipientActorId: recipient.recipientActorId, recipientRole: recipient.recipientRole, operationType: operation?.operation_type ?? 'unknown', failureSummary: flag.last_error_summary ?? 'Manual intervention required', suggestedActions: operation?.failure_suggested_actions ?? ['Inspect logs and coordinate supervised recovery.'], correlationId: operation?.correlation_id ?? params.correlationId ?? 'n/a' });
  }
  dependencies.log(JSON.stringify({ level: 'info', event: 'async_operation_intervention_notification', operation_id: flag.operation_id, tenant_id: flag.tenant_id, correlation_id: operation?.correlation_id ?? null }));
  return { statusCode: 200, body: { notified: recipients.length } };
}

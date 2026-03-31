import {
  AUDIT_MODULE_SERVICE_ID,
  getContract,
  getService,
  listAdapterPortsForConsumer
} from '../../internal-contracts/src/index.mjs';

export const auditModuleBoundary = getService(AUDIT_MODULE_SERVICE_ID);
export const auditRecordContract = getContract('audit_record');
export const iamLifecycleEventContract = getContract('iam_lifecycle_event');
export const mongoAdminEventContract = getContract('mongo_admin_event');
export const kafkaAdminEventContract = getContract('kafka_admin_event');
export const auditPersistenceAdapters = listAdapterPortsForConsumer(AUDIT_MODULE_SERVICE_ID);

/**
 * Capability enforcement denied event — security category (extended retention).
 *
 * Emitted when the gateway or console blocks an action because the tenant's plan
 * does not include the required boolean capability (or an override explicitly disables it).
 *
 * Classified alongside `scope_insufficient` and `privilege_domain_denied` for
 * retention policy purposes.
 */
export const capabilityEnforcementDeniedEvent = {
  eventType: 'capability_enforcement_denied',
  category: 'security',
  fields: {
    eventType: { type: 'string', enum: ['capability_enforcement_denied'] },
    tenantId: { type: 'string', description: 'UUID of the tenant' },
    workspaceId: { type: 'string', nullable: true, description: 'UUID of the workspace if applicable' },
    actorId: { type: 'string', description: 'sub from JWT or client_id' },
    actorType: { type: 'string', enum: ['user', 'service_account'] },
    capability: { type: 'string', description: 'Key of the blocked capability' },
    reason: { type: 'string', enum: ['plan_restriction', 'override_restriction', 'plan_unresolvable'] },
    channel: { type: 'string', enum: ['gateway', 'console', 'internal_api'] },
    resourcePath: { type: 'string', description: 'Requested resource path' },
    httpMethod: { type: 'string', description: 'HTTP method (GET, POST, etc.)' },
    requestId: { type: 'string', description: 'Request correlation ID' },
    correlationId: { type: 'string', description: 'End-to-end correlation ID' },
    sourceIp: { type: 'string', description: 'Client IP address' },
    occurredAt: { type: 'string', description: 'ISO 8601 UTC timestamp' }
  }
};

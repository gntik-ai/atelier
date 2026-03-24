import {
  AUDIT_MODULE_SERVICE_ID,
  getContract,
  getService,
  listAdapterPortsForConsumer
} from '../../internal-contracts/src/index.mjs';

export const auditModuleBoundary = getService(AUDIT_MODULE_SERVICE_ID);
export const auditRecordContract = getContract('audit_record');
export const iamLifecycleEventContract = getContract('iam_lifecycle_event');
export const auditPersistenceAdapters = listAdapterPortsForConsumer(AUDIT_MODULE_SERVICE_ID);

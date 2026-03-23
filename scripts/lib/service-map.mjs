import { existsSync } from 'node:fs';

import { readJson } from './quality-gates.mjs';

export const INTERNAL_SERVICE_MAP_PATH = 'services/internal-contracts/src/internal-service-map.json';
export const REQUIRED_SERVICE_IDS = ['control_api', 'provisioning_orchestrator', 'audit_module'];
export const REQUIRED_ADAPTER_IDS = ['keycloak', 'postgresql', 'mongodb', 'kafka', 'openwhisk', 'storage'];
export const REQUIRED_CONTRACT_IDS = [
  'control_api_command',
  'provisioning_request',
  'provisioning_result',
  'adapter_call',
  'adapter_result',
  'audit_record'
];
export const REQUIRED_AUTHORIZATION_FIELDS = {
  control_api_command: ['tenant_id', 'workspace_id', 'plan_id', 'scopes', 'effective_roles', 'correlation_id', 'authorization_decision_id'],
  provisioning_request: ['tenant_id', 'workspace_id', 'plan_id', 'scopes', 'effective_roles', 'correlation_id', 'authorization_decision_id'],
  adapter_call: ['tenant_id', 'workspace_id', 'plan_id', 'scopes', 'effective_roles', 'correlation_id', 'authorization_decision_id'],
  audit_record: ['tenant_id', 'workspace_id', 'correlation_id', 'authorization_decision_id', 'effective_roles', 'delegation_chain']
};

export function readServiceMap() {
  return readJson(INTERNAL_SERVICE_MAP_PATH);
}

function ensureNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function collectCycleViolations(serviceIndex) {
  const visiting = new Set();
  const visited = new Set();
  const violations = [];

  function walk(serviceId, stack = []) {
    if (visiting.has(serviceId)) {
      violations.push(`Service dependency cycle detected: ${[...stack, serviceId].join(' -> ')}`);
      return;
    }

    if (visited.has(serviceId)) return;

    visiting.add(serviceId);
    const service = serviceIndex.get(serviceId);
    for (const dependencyId of service?.service_dependencies ?? []) {
      if (serviceIndex.has(dependencyId)) {
        walk(dependencyId, [...stack, serviceId]);
      }
    }
    visiting.delete(serviceId);
    visited.add(serviceId);
  }

  for (const serviceId of serviceIndex.keys()) {
    walk(serviceId);
  }

  return violations;
}

export function collectServiceMapViolations(serviceMap = readServiceMap()) {
  const violations = [];

  if (typeof serviceMap?.version !== 'string' || serviceMap.version.length === 0) {
    violations.push('Service map version must be a non-empty string.');
  }

  if (!ensureNonEmptyArray(serviceMap?.principles)) {
    violations.push('Service map principles must be a non-empty array.');
  }

  const services = serviceMap?.services;
  if (!ensureNonEmptyArray(services)) {
    violations.push('Service map services must be a non-empty array.');
    return violations;
  }

  const serviceIndex = new Map();
  for (const service of services) {
    if (!service?.id) {
      violations.push('Each service must define a stable id.');
      continue;
    }

    if (serviceIndex.has(service.id)) {
      violations.push(`Duplicate service id ${service.id}.`);
      continue;
    }

    serviceIndex.set(service.id, service);

    if (!service.package || !existsSync(service.package)) {
      violations.push(`Service ${service.id} must reference an existing package path.`);
    }

    if (!ensureNonEmptyArray(service.responsibilities)) {
      violations.push(`Service ${service.id} must define responsibilities.`);
    }

    if (!ensureNonEmptyArray(service.owned_resources)) {
      violations.push(`Service ${service.id} must define owned_resources.`);
    }

    if (!Array.isArray(service.service_dependencies)) {
      violations.push(`Service ${service.id} must define service_dependencies as an array.`);
    }

    if (!Array.isArray(service.adapter_dependencies)) {
      violations.push(`Service ${service.id} must define adapter_dependencies as an array.`);
    }

    if (!Array.isArray(service.inbound_contracts)) {
      violations.push(`Service ${service.id} must define inbound_contracts as an array.`);
    }

    if (!Array.isArray(service.outbound_contracts)) {
      violations.push(`Service ${service.id} must define outbound_contracts as an array.`);
    }
  }

  for (const serviceId of REQUIRED_SERVICE_IDS) {
    if (!serviceIndex.has(serviceId)) {
      violations.push(`Service map must include ${serviceId}.`);
    }
  }

  violations.push(...collectCycleViolations(serviceIndex));

  const adapterPorts = serviceMap?.adapter_ports;
  if (!ensureNonEmptyArray(adapterPorts)) {
    violations.push('Service map adapter_ports must be a non-empty array.');
  }

  const adapterIndex = new Map();
  for (const adapter of adapterPorts ?? []) {
    if (!adapter?.id) {
      violations.push('Each adapter port must define a stable id.');
      continue;
    }

    if (adapterIndex.has(adapter.id)) {
      violations.push(`Duplicate adapter port id ${adapter.id}.`);
      continue;
    }

    adapterIndex.set(adapter.id, adapter);

    if (!adapter.package || !existsSync(adapter.package)) {
      violations.push(`Adapter port ${adapter.id} must reference an existing package path.`);
    }

    if (!ensureNonEmptyArray(adapter.capabilities)) {
      violations.push(`Adapter port ${adapter.id} must define capabilities.`);
    }

    if (!ensureNonEmptyArray(adapter.consumers)) {
      violations.push(`Adapter port ${adapter.id} must define consumers.`);
    }

    for (const consumer of adapter.consumers ?? []) {
      if (!serviceIndex.has(consumer)) {
        violations.push(`Adapter port ${adapter.id} references unknown consumer ${consumer}.`);
      }
    }

    if (adapter.request_contract !== 'adapter_call') {
      violations.push(`Adapter port ${adapter.id} must use adapter_call as request_contract.`);
    }

    if (adapter.result_contract !== 'adapter_result') {
      violations.push(`Adapter port ${adapter.id} must use adapter_result as result_contract.`);
    }

    if (typeof adapter.idempotency_key !== 'string' || adapter.idempotency_key.length === 0) {
      violations.push(`Adapter port ${adapter.id} must define idempotency_key guidance.`);
    }

    if (!ensureNonEmptyArray(adapter.error_classes)) {
      violations.push(`Adapter port ${adapter.id} must define error_classes.`);
    }
  }

  for (const adapterId of REQUIRED_ADAPTER_IDS) {
    if (!adapterIndex.has(adapterId)) {
      violations.push(`Service map must include adapter port ${adapterId}.`);
    }
  }

  const contracts = serviceMap?.contracts ?? {};
  for (const contractId of REQUIRED_CONTRACT_IDS) {
    const contract = contracts[contractId];

    if (!contract) {
      violations.push(`Service map must include contract ${contractId}.`);
      continue;
    }

    if (!contract.owner || !serviceIndex.has(contract.owner) && contract.owner !== 'services/adapters') {
      violations.push(`Contract ${contractId} must define a known owner.`);
    }

    if (contract.version !== serviceMap.version) {
      violations.push(`Contract ${contractId} version must align with service-map version ${serviceMap.version}.`);
    }

    if (!ensureNonEmptyArray(contract.required_fields)) {
      violations.push(`Contract ${contractId} must define required_fields.`);
    }

    if (typeof contract.idempotency !== 'string' || contract.idempotency.length === 0) {
      violations.push(`Contract ${contractId} must define idempotency expectations.`);
    }

    if (typeof contract.versioning !== 'string' || contract.versioning.length === 0) {
      violations.push(`Contract ${contractId} must define versioning expectations.`);
    }

    if (!ensureNonEmptyArray(contract.error_classes)) {
      violations.push(`Contract ${contractId} must define error_classes.`);
    }
  }

  const knownContractIds = new Set(Object.keys(contracts));
  for (const service of services) {
    for (const dependencyId of service.service_dependencies ?? []) {
      if (!serviceIndex.has(dependencyId)) {
        violations.push(`Service ${service.id} references unknown service dependency ${dependencyId}.`);
      }
      if (dependencyId === service.id) {
        violations.push(`Service ${service.id} must not depend on itself.`);
      }
    }

    for (const adapterId of service.adapter_dependencies ?? []) {
      if (!adapterIndex.has(adapterId)) {
        violations.push(`Service ${service.id} references unknown adapter dependency ${adapterId}.`);
      }
    }

    for (const contractId of [...(service.inbound_contracts ?? []), ...(service.outbound_contracts ?? [])]) {
      if (!knownContractIds.has(contractId)) {
        violations.push(`Service ${service.id} references unknown contract ${contractId}.`);
      }
    }
  }

  const controlApi = serviceIndex.get('control_api');
  if (controlApi) {
    if ((controlApi.adapter_dependencies ?? []).length > 0) {
      violations.push('control_api must not depend on provider adapters directly.');
    }

    for (const requiredDependency of ['provisioning_orchestrator', 'audit_module']) {
      if (!(controlApi.service_dependencies ?? []).includes(requiredDependency)) {
        violations.push(`control_api must depend on ${requiredDependency}.`);
      }
    }
  }

  const provisioningOrchestrator = serviceIndex.get('provisioning_orchestrator');
  if (provisioningOrchestrator) {
    for (const adapterId of REQUIRED_ADAPTER_IDS) {
      if (!(provisioningOrchestrator.adapter_dependencies ?? []).includes(adapterId)) {
        violations.push(`provisioning_orchestrator must depend on adapter ${adapterId}.`);
      }
    }

    if (!(provisioningOrchestrator.service_dependencies ?? []).includes('audit_module')) {
      violations.push('provisioning_orchestrator must depend on audit_module.');
    }
  }

  const auditModule = serviceIndex.get('audit_module');
  if (auditModule) {
    if ((auditModule.service_dependencies ?? []).length > 0) {
      violations.push('audit_module must not depend on other services in the baseline.');
    }

    for (const adapterId of ['postgresql', 'storage']) {
      if (!(auditModule.adapter_dependencies ?? []).includes(adapterId)) {
        violations.push(`audit_module must depend on adapter ${adapterId}.`);
      }
    }
  }

  if (contracts.audit_record?.write_mode !== 'append_only') {
    violations.push('Contract audit_record must declare write_mode append_only.');
  }

  if (!(contracts.control_api_command?.required_fields ?? []).includes('idempotency_key')) {
    violations.push('Contract control_api_command must require idempotency_key.');
  }

  if (!(contracts.provisioning_request?.required_fields ?? []).includes('idempotency_key')) {
    violations.push('Contract provisioning_request must require idempotency_key.');
  }

  for (const [contractId, requiredFields] of Object.entries(REQUIRED_AUTHORIZATION_FIELDS)) {
    const actualFields = contracts[contractId]?.required_fields ?? [];

    for (const field of requiredFields) {
      if (!actualFields.includes(field)) {
        violations.push(`Contract ${contractId} must require authorization field ${field}.`);
      }
    }
  }

  if (!ensureNonEmptyArray(serviceMap?.interaction_flows)) {
    violations.push('Service map interaction_flows must be a non-empty array.');
  } else if (!(serviceMap.interaction_flows ?? []).some((flow) => flow.id === 'tenant_provisioning')) {
    violations.push('Service map must include tenant_provisioning interaction flow.');
  }

  return violations;
}

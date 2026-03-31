import { randomUUID } from 'node:crypto';
import * as catalogRepository from '../repositories/boolean-capability-catalog-repository.mjs';
import * as planCapabilityRepository from '../repositories/plan-capability-repository.mjs';
import { emitCapabilityEvents } from '../events/plan-capability-events.mjs';

const ERROR_STATUS_CODES = {
  FORBIDDEN: 403,
  INVALID_CAPABILITY_KEY: 400,
  INVALID_CAPABILITY_VALUE: 400,
  NO_CAPABILITIES_SPECIFIED: 400,
  PLAN_NOT_FOUND: 404,
  PLAN_ARCHIVED: 409,
  CONCURRENT_CAPABILITY_CONFLICT: 409
};

function requireSuperadmin(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id || actor.type !== 'superadmin') throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  return actor;
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  const producer = overrides.producer ?? params.producer;
  try {
    const actor = requireSuperadmin(params);
    if (!params.capabilities || typeof params.capabilities !== 'object' || Array.isArray(params.capabilities) || Object.keys(params.capabilities).length === 0) {
      throw Object.assign(new Error('No capabilities specified'), { code: 'NO_CAPABILITIES_SPECIFIED' });
    }
    for (const value of Object.values(params.capabilities)) {
      if (typeof value !== 'boolean') throw Object.assign(new Error('Invalid capability value'), { code: 'INVALID_CAPABILITY_VALUE' });
    }
    await catalogRepository.validateCapabilityKeys(db, Object.keys(params.capabilities));
    const correlationId = params.correlationId ?? randomUUID();
    const result = await planCapabilityRepository.setCapabilities(db, {
      planId: params.planId,
      capabilitiesToSet: params.capabilities,
      actorId: actor.id,
      correlationId
    });
    if (result.changed.length > 0) {
      const catalog = await catalogRepository.listActiveCatalog(db);
      const labelMap = new Map(catalog.map((entry) => [entry.capabilityKey, entry.displayLabel]));
      await emitCapabilityEvents(producer, {
        planId: result.planId,
        planSlug: result.planSlug,
        changedItems: result.changed.map((entry) => ({ ...entry, displayLabel: labelMap.get(entry.capabilityKey) ?? entry.capabilityKey })),
        actorId: actor.id,
        correlationId,
        timestamp: new Date().toISOString()
      });
    }
    return { statusCode: 200, body: { planId: result.planId, planSlug: result.planSlug, changed: result.changed, unchanged: result.unchanged, effectiveCapabilities: result.effectiveCapabilities } };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}

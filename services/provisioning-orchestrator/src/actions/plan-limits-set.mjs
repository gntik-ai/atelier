import { randomUUID } from 'node:crypto';
import { isValidDimensionKey, isValidLimitValue } from '../models/quota-dimension.mjs';
import * as catalogRepository from '../repositories/quota-dimension-catalog-repository.mjs';
import * as planLimitsRepository from '../repositories/plan-limits-repository.mjs';
import { emitLimitUpdated } from '../events/plan-limit-events.mjs';

const ERROR_STATUS_CODES = {
  FORBIDDEN: 403,
  INVALID_DIMENSION_KEY: 400,
  INVALID_LIMIT_VALUE: 400,
  PLAN_NOT_FOUND: 404,
  PLAN_LIMITS_FROZEN: 409,
  CONCURRENT_PLAN_LIMIT_CONFLICT: 409
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
    if (!isValidDimensionKey(params.dimensionKey)) throw Object.assign(new Error('Invalid dimension key'), { code: 'INVALID_DIMENSION_KEY' });
    if (!isValidLimitValue(params.value)) throw Object.assign(new Error('Invalid limit value'), { code: 'INVALID_LIMIT_VALUE' });
    const exists = await catalogRepository.dimensionKeyExists(db, params.dimensionKey);
    if (!exists) throw Object.assign(new Error('Invalid dimension key'), { code: 'INVALID_DIMENSION_KEY' });

    const correlationId = params.correlationId ?? randomUUID();
    const result = await planLimitsRepository.setLimit(db, {
      planId: params.planId,
      dimensionKey: params.dimensionKey,
      value: params.value,
      actorId: actor.id,
      correlationId
    });

    if (result.planStatus === 'active') {
      await emitLimitUpdated(producer, {
        planId: result.planId,
        dimensionKey: result.dimensionKey,
        previousValue: result.previousValue,
        newValue: result.newValue,
        actorId: actor.id,
        correlationId
      });
    }

    return {
      statusCode: 200,
      body: {
        planId: result.planId,
        dimensionKey: result.dimensionKey,
        previousValue: result.previousValue,
        newValue: result.newValue,
        source: 'explicit'
      }
    };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}

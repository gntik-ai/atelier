import * as catalogRepository from '../repositories/quota-dimension-catalog-repository.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403 };

function requireSuperadmin(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id || actor.type !== 'superadmin') throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  try {
    requireSuperadmin(params);
    const dimensions = await catalogRepository.listAllDimensions(db);
    return {
      statusCode: 200,
      body: {
        dimensions: dimensions.map((dimension) => ({
          dimensionKey: dimension.dimensionKey,
          displayLabel: dimension.displayLabel,
          unit: dimension.unit,
          defaultValue: dimension.defaultValue,
          description: dimension.description
        })),
        total: dimensions.length
      }
    };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}

import * as catalogRepository from '../repositories/boolean-capability-catalog-repository.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403 };

function requireSuperadmin(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id || actor.type !== 'superadmin') throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  try {
    requireSuperadmin(params);
    const includeInactive = Boolean(params.includeInactive);
    const capabilities = includeInactive
      ? await catalogRepository.listAllCatalog(db, { includeInactive: true })
      : await catalogRepository.listActiveCatalog(db);
    return {
      statusCode: 200,
      body: {
        capabilities: capabilities.map((entry) => ({
          capabilityKey: entry.capabilityKey,
          displayLabel: entry.displayLabel,
          description: entry.description,
          platformDefault: entry.platformDefault,
          isActive: entry.isActive,
          sortOrder: entry.sortOrder
        })),
        total: capabilities.length
      }
    };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}

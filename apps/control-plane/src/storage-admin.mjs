import {
  filterPublicRoutes,
  getApiFamily,
  getPublicRoute
} from '../../../services/internal-contracts/src/index.mjs';
import {
  STORAGE_PROVIDER_ERROR_CODES,
  STORAGE_PROVIDER_CAPABILITY_FIELDS,
  buildStorageProviderProfile,
  listSupportedStorageProviders,
  summarizeStorageProviderCompatibility
} from '../../../services/adapters/src/storage-provider-profile.mjs';

export const storageApiFamily = getApiFamily('storage');
export const STORAGE_ADMIN_ERROR_CODES = STORAGE_PROVIDER_ERROR_CODES;
export const STORAGE_PROVIDER_CAPABILITIES = STORAGE_PROVIDER_CAPABILITY_FIELDS;

function matchesRouteFilters(route, filters = {}) {
  return Object.entries(filters).every(([key, value]) => route?.[key] === value);
}

export function listStorageAdminRoutes(filters = {}) {
  const storageRoutes = filterPublicRoutes({ family: 'storage' });
  const providerRoute = getPublicRoute('getStorageProviderIntrospection');
  const combinedRoutes = providerRoute ? [...storageRoutes, providerRoute] : storageRoutes;

  return combinedRoutes.filter((route) => matchesRouteFilters(route, filters));
}

export const storageAdminRoutes = listStorageAdminRoutes();

export function getStorageAdminRoute(operationId) {
  const route = getPublicRoute(operationId);
  return route && (route.family === 'storage' || route.resourceType === 'storage_provider') ? route : undefined;
}

export function summarizeStorageProviderSupport(input = {}) {
  return buildStorageProviderProfile(input);
}

export function summarizeStorageProviderIntrospection(input = {}) {
  const route = getStorageAdminRoute('getStorageProviderIntrospection');
  const profile = summarizeStorageProviderSupport(input);

  return {
    route,
    profile,
    supportedProviders: listSupportedStorageProviders(),
    capabilityFields: [...STORAGE_PROVIDER_CAPABILITY_FIELDS]
  };
}

export function getStorageCompatibilitySummary(input = {}) {
  const compatibility = summarizeStorageProviderCompatibility(input);
  const providerRoute = getStorageAdminRoute('getStorageProviderIntrospection');

  return {
    ...compatibility,
    routeIds: providerRoute ? [providerRoute.operationId] : [],
    publicBucketRoutes: storageAdminRoutes
      .filter((route) => route.resourceType === 'bucket')
      .map((route) => route.operationId)
  };
}

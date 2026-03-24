import {
  filterPublicRoutes,
  getApiFamily,
  getContract,
  getPublicRoute
} from '../../../services/internal-contracts/src/index.mjs';
import {
  IAM_ADMIN_CAPABILITY_MATRIX,
  IAM_ADMIN_RESOURCE_KINDS,
  SUPPORTED_KEYCLOAK_VERSION_RANGES,
  isKeycloakVersionSupported
} from '../../../services/adapters/src/keycloak-admin.mjs';

export const iamAdminApiFamily = getApiFamily('iam');
export const iamAdminRequestContract = getContract('iam_admin_request');
export const iamAdminResultContract = getContract('iam_admin_result');
export const iamAdminRoutes = filterPublicRoutes({ family: 'iam' });

export function listIamAdminRoutes(filters = {}) {
  return filterPublicRoutes({ family: 'iam', ...filters });
}

export function getIamAdminRoute(operationId) {
  const route = getPublicRoute(operationId);
  return route?.family === 'iam' ? route : undefined;
}

export function summarizeIamAdminSurface() {
  return IAM_ADMIN_RESOURCE_KINDS.map((resourceKind) => ({
    resourceKind,
    actions: IAM_ADMIN_CAPABILITY_MATRIX[resourceKind] ?? [],
    routeCount: iamAdminRoutes.filter((route) => route.resourceType === `iam_${resourceKind}`).length
  }));
}

export function getIamCompatibilitySummary() {
  return {
    provider: 'keycloak',
    contractVersion: iamAdminRequestContract?.version ?? '2026-03-24',
    supportedVersions: SUPPORTED_KEYCLOAK_VERSION_RANGES.map(({ range, label, adminApiStability }) => ({
      range,
      label,
      adminApiStability
    }))
  };
}

export { isKeycloakVersionSupported };

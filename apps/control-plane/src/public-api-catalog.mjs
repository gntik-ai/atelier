import {
  filterPublicRoutes,
  getApiFamily,
  getPublicApiRelease,
  listApiFamilies,
  listPublicRoutes,
  listResourceTaxonomy
} from '../../../services/internal-contracts/src/index.mjs';

export const publicApiRelease = getPublicApiRelease();
export const publicApiFamilies = listApiFamilies();
export const publicApiRoutes = listPublicRoutes();
export const publicApiResourceTaxonomy = listResourceTaxonomy();

export function getPublicApiFamily(familyId) {
  return getApiFamily(familyId);
}

export function listControlPlaneRoutes(filters = {}) {
  return filterPublicRoutes(filters);
}

export function summarizePublicApiFamilies() {
  return publicApiFamilies.map((family) => ({
    id: family.id,
    title: family.title,
    prefix: family.prefix,
    routeCount: publicApiRoutes.filter((route) => route.family === family.id).length,
    scopes: family.resource_scopes,
    audiences: family.audiences
  }));
}

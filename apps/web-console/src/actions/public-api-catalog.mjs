import {
  filterPublicRoutes,
  listApiFamilies,
  listPublicRoutes
} from '../../../../services/internal-contracts/src/index.mjs';

export const consoleVisibleApiFamilies = listApiFamilies();
export const consoleVisibleApiRoutes = listPublicRoutes();

export function filterConsoleApiRoutes(filters = {}) {
  return filterPublicRoutes(filters);
}

export function buildConsoleRouteSections() {
  return consoleVisibleApiFamilies.map((family) => ({
    id: family.id,
    title: family.title,
    prefix: family.prefix,
    routes: consoleVisibleApiRoutes.filter((route) => route.family === family.id)
  }));
}

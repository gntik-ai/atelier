import test from 'node:test';
import assert from 'node:assert/strict';

import { getPublicRoute } from '../../../services/internal-contracts/src/index.mjs';
import { listFunctionImportExportRoutes } from '../../../apps/control-plane/src/functions-import-export.mjs';

test('console-facing function import-export scaffold stays on public routes and bounded resource types', () => {
  const exportRoute = getPublicRoute('exportFunctionDefinition');
  const importRoute = getPublicRoute('importFunctionDefinition');
  const routes = listFunctionImportExportRoutes();

  assert.equal(exportRoute.visibility, 'public');
  assert.equal(importRoute.visibility, 'public');
  assert.equal(importRoute.path.includes('/definition-imports'), true);
  assert.equal(routes.length, 4);
  assert.equal(routes.every((route) => ['function_definition_export', 'function_definition_import'].includes(route.resourceType)), true);
});

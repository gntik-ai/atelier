import test from 'node:test';
import assert from 'node:assert/strict';

import { OPENAPI_PATH, readJson } from '../../scripts/lib/quality-gates.mjs';
import {
  buildRouteCatalog,
  collectPublicApiViolations,
  listFamilyDocumentPaths,
  readGatewayRouting,
  readPublicApiTaxonomy,
  readPublicRouteCatalog
} from '../../scripts/lib/public-api.mjs';

test('public API taxonomy, gateway routing, and generated route catalog remain aligned', () => {
  const document = readJson(OPENAPI_PATH);
  const taxonomy = readPublicApiTaxonomy();
  const routeCatalog = readPublicRouteCatalog();
  const regeneratedCatalog = buildRouteCatalog(document, taxonomy);
  const violations = collectPublicApiViolations({
    document,
    taxonomy,
    routeCatalog,
    gatewayRouting: readGatewayRouting()
  });

  assert.equal(taxonomy.release.path_version, 'v1');
  assert.equal(taxonomy.release.header_version, '2026-03-24');
  assert.equal(taxonomy.release.openapi_semver, '1.1.0');
  assert.equal(listFamilyDocumentPaths().length, taxonomy.families.length);
  assert.deepEqual(routeCatalog.routes, regeneratedCatalog.routes);
  assert.ok(routeCatalog.routes.every((route) => typeof route.gatewayQosProfile === 'string'));
  assert.ok(routeCatalog.routes.every((route) => typeof route.gatewayRequestValidationProfile === 'string'));
  assert.ok(routeCatalog.routes.every((route) => route.errorEnvelope === 'ErrorResponse'));
  assert.deepEqual(violations, []);
});

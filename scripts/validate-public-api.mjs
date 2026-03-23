import SwaggerParser from '@apidevtools/swagger-parser';

import { OPENAPI_PATH } from './lib/quality-gates.mjs';
import {
  collectPublicApiViolations,
  listFamilyDocumentPaths,
  readPublicRouteCatalog,
  writeGeneratedFamilyDocuments,
  writeGeneratedPublicApiDocs,
  writeGeneratedRouteCatalog
} from './lib/public-api.mjs';

await SwaggerParser.validate(OPENAPI_PATH);
writeGeneratedFamilyDocuments();
writeGeneratedRouteCatalog();
writeGeneratedPublicApiDocs();

for (const path of listFamilyDocumentPaths()) {
  await SwaggerParser.validate(path);
}

const violations = collectPublicApiViolations({ routeCatalog: readPublicRouteCatalog() });

if (violations.length > 0) {
  throw new Error(`Public API validation failed:\n- ${violations.join('\n- ')}`);
}

console.log('Public API taxonomy, route catalog, gateway routing, and family contracts are aligned.');

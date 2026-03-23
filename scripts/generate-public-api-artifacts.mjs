import { OPENAPI_PATH, readJson } from './lib/quality-gates.mjs';
import {
  writeGeneratedFamilyDocuments,
  writeGeneratedPublicApiDocs,
  writeGeneratedRouteCatalog
} from './lib/public-api.mjs';

const document = readJson(OPENAPI_PATH);
writeGeneratedFamilyDocuments(document);
writeGeneratedRouteCatalog(document);
writeGeneratedPublicApiDocs(document);

console.log('Generated public API family contracts, route catalog, and published docs.');

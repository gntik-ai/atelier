import SwaggerParser from '@apidevtools/swagger-parser';
import { OPENAPI_PATH } from './lib/quality-gates.mjs';

await SwaggerParser.validate(OPENAPI_PATH);
console.log(`OpenAPI contract is structurally valid: ${OPENAPI_PATH}`);

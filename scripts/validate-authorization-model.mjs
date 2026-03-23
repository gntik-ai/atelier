import { collectAuthorizationModelViolations, readAuthorizationModel } from './lib/authorization-model.mjs';

const authorizationModel = readAuthorizationModel();
const violations = collectAuthorizationModelViolations(authorizationModel);

if (violations.length > 0) {
  console.error('Authorization model validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Authorization model is present and internally consistent.');

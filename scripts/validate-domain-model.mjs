import { collectDomainModelViolations, readDomainModel } from './lib/domain-model.mjs';

const domainModel = readDomainModel();
const violations = collectDomainModelViolations(domainModel);

if (violations.length > 0) {
  console.error('Domain model validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Domain model is present and internally consistent.');

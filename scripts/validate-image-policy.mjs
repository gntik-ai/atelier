import { IMAGE_VALUES_PATH, collectImageTargets, readYaml, validateImagePolicy } from './lib/quality-gates.mjs';

const values = readYaml(IMAGE_VALUES_PATH);
const violations = validateImagePolicy(values);

if (violations.length > 0) {
  console.error('Image supply-chain policy violations:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('Image supply-chain policy is valid for declared deployable images.');
for (const target of collectImageTargets(values)) {
  if (!target.enabled) continue;
  const suffix = target.image.digest ? `@${target.image.digest}` : `:${target.image.tag}`;
  console.log(`- ${target.name}: ${target.image.repository}${suffix}`);
}

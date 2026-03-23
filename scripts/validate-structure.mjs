import { existsSync } from 'node:fs';

const requiredPaths = [
  'README.md',
  'package.json',
  'pnpm-workspace.yaml',
  'turbo.json',
  '.markdownlint-cli2.jsonc',
  '.specify/memory/constitution.md',
  'apps/control-plane/package.json',
  'apps/control-plane/openapi/control-plane.openapi.json',
  'apps/web-console/package.json',
  'services/gateway-config/README.md',
  'services/adapters/package.json',
  'charts/in-atelier/Chart.yaml',
  'charts/in-atelier/values.yaml',
  'docs/conventions.md',
  'docs/adr/0001-monorepo-bootstrap.md',
  'docs/tasks/us-prg-03-t01.md',
  'tests/e2e/package.json',
  'tests/unit/quality-gates.test.mjs',
  'tests/contracts/control-plane.openapi.test.mjs',
  'scripts/lib/quality-gates.mjs',
  'scripts/validate-openapi.mjs',
  'scripts/validate-image-policy.mjs',
  '.github/workflows/ci.yml',
  'specs/us-prg-03-t01/spec.md',
  'specs/us-prg-03-t01/plan.md',
  'specs/us-prg-03-t01/research.md',
  'specs/us-prg-03-t01/quickstart.md',
  'specs/us-prg-03-t01/tasks.md'
];

const missing = requiredPaths.filter((path) => !existsSync(path));

if (missing.length > 0) {
  console.error('Missing required bootstrap/quality paths:');
  for (const path of missing) console.error(`- ${path}`);
  process.exit(1);
}

console.log('Monorepo bootstrap and CI quality structure are valid.');

import { existsSync } from 'node:fs';

const requiredPaths = [
  'README.md',
  'package.json',
  'pnpm-workspace.yaml',
  'turbo.json',
  '.specify/memory/constitution.md',
  'apps/control-plane/package.json',
  'apps/web-console/package.json',
  'services/gateway-config/README.md',
  'services/adapters/package.json',
  'charts/in-atelier/Chart.yaml',
  'charts/in-atelier/values.yaml',
  'docs/conventions.md',
  'docs/adr/0001-monorepo-bootstrap.md',
  'tests/e2e/package.json',
  '.github/workflows/ci.yml'
];

const missing = requiredPaths.filter((path) => !existsSync(path));

if (missing.length > 0) {
  console.error('Missing required bootstrap paths:');
  for (const path of missing) console.error(`- ${path}`);
  process.exit(1);
}

console.log('Monorepo bootstrap structure is valid.');

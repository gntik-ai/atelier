import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { parse } from 'yaml';

export const SERVICE_CATALOG_PATH = 'service-catalog.json';
export const RELEASE_WORKFLOW_PATH = '.github/workflows/release-images.yml';

export const REQUIRED_RELEASE_IMAGES = [
  'in-falcone-control-plane',
  'in-falcone-control-plane-executor',
  'in-falcone-web-console',
  'in-falcone-fn-runtime',
  'in-falcone-workflow-worker',
  'in-falcone-mcp-runtime'
];

export const REQUIRED_SHARED_PACKAGES = [
  'adapters',
  'audit',
  'audit-anomaly-handler',
  'backup-status',
  'billing-export',
  'event-gateway',
  'internal-contracts',
  'mongo-cdc-bridge',
  'openapi-sdk-service',
  'pg-cdc-bridge',
  'provisioning-orchestrator',
  'realtime-gateway',
  'scheduling-engine',
  'secret-audit-handler',
  'webhook-engine',
  'workspace-docs-service',
  'mcp-server-sdk'
];

export const REQUIRED_NON_RELEASE_CANDIDATES = [
  'mongo-cdc-bridge',
  'pg-cdc-bridge',
  'realtime-gateway',
  'workspace-docs-service'
];

export const FORBIDDEN_OLD_ROOTS = [
  'deploy/kind/control-plane/',
  'deploy/kind/fn-runtime/',
  'deploy/release/web-console.Dockerfile',
  'services/adapters/',
  'services/audit/',
  'services/audit-anomaly-handler/',
  'services/backup-status/',
  'services/billing-export/',
  'services/event-gateway/',
  'services/gateway-config/',
  'services/internal-contracts/',
  'services/keycloak-config/',
  'services/mongo-cdc-bridge/',
  'services/openapi-sdk-service/',
  'services/pg-cdc-bridge/',
  'services/provisioning-orchestrator/',
  'services/realtime-gateway/',
  'services/scheduling-engine/',
  'services/secret-audit-handler/',
  'services/webhook-engine/',
  'services/workflow-worker/',
  'services/workspace-docs-service/',
  'apps/mcp-server-sdk/',
  'apps/cli/'
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sorted(values) {
  return [...values].sort();
}

function sameSet(left, right) {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

function listTrackedFiles() {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

function readReleaseMatrix() {
  const workflow = parse(readFileSync(RELEASE_WORKFLOW_PATH, 'utf8'));
  return workflow?.jobs?.['build-push']?.strategy?.matrix?.include ?? [];
}

function dockerfileParent(path) {
  return dirname(path).replaceAll('\\', '/');
}

function normalizeCopyLines(text) {
  const lines = [];
  let current = '';
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!current && !line.trim()) continue;
    if (line.trimEnd().endsWith('\\')) {
      current += `${line.trimEnd().slice(0, -1)} `;
      continue;
    }
    lines.push(`${current}${line}`.trim());
    current = '';
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

function splitCopyArgs(line) {
  const match = line.match(/^COPY\s+(.+)$/i);
  if (!match) return [];
  const args = match[1].trim().split(/\s+/);
  if (args.some((arg) => arg.startsWith('--from='))) return [];
  while (args[0]?.startsWith('--')) args.shift();
  if (args.length < 2) return [];
  return args.slice(0, -1);
}

export function isGeneratedBuildArtifact(source, context, entry) {
  return entry?.build_spa === 'true'
    && context === '.'
    && source === `${dockerfileParent(entry.dockerfile)}/dist`;
}

function sourceExistsInContext(source, context, entry) {
  if (source.startsWith('/') || source.includes('*') || source.includes('$')) return true;
  if (isGeneratedBuildArtifact(source, context, entry)) return true;
  return existsSync(normalize(join(context, source)));
}

export function readServiceCatalog() {
  return readJson(SERVICE_CATALOG_PATH);
}

// Parse a Dockerfile for the two things the base-image contract cares about:
//   - global `ARG NAME=default` declarations (name -> default string, or null when no default), and
//   - every `FROM` base reference, tagged with the build ARG it interpolates (if any) and whether it
//     merely re-uses a previously defined build stage (`FROM <stage> AS ...`, an internal reference
//     that is not an external base image).
// Stripping trailing comments and honoring `AS <stage>` keeps this robust for the multi-stage
// web-console and workflow-worker Dockerfiles.
export function parseDockerfileBaseImages(dockerfilePath) {
  const text = readFileSync(dockerfilePath, 'utf8');
  const argDefaults = new Map();
  const fromRefs = [];
  const stageNames = new Set();

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;

    const argWithDefault = line.match(/^ARG\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/i);
    if (argWithDefault) {
      argDefaults.set(argWithDefault[1], argWithDefault[2]);
      continue;
    }
    const argNoDefault = line.match(/^ARG\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i);
    if (argNoDefault) {
      if (!argDefaults.has(argNoDefault[1])) argDefaults.set(argNoDefault[1], null);
      continue;
    }

    const fromMatch = line.match(/^FROM\s+(.+)$/i);
    if (!fromMatch) continue;
    let rest = fromMatch[1].trim();
    while (rest.startsWith('--')) rest = rest.replace(/^--\S+\s*/, '');
    const token = rest.split(/\s+/)[0];
    const stageName = rest.match(/\s+AS\s+([^\s]+)\s*$/i)?.[1] ?? null;
    const argRef = token.match(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/);
    fromRefs.push({ raw: token, argName: argRef?.[1] ?? null, isStageRef: stageNames.has(token) });
    if (stageName) stageNames.add(stageName);
  }

  return { argDefaults, fromRefs };
}

// Return the `USER` in effect at the END of the FINAL build stage — the only one baked into the
// published image config. `USER` is stage-scoped, so every `FROM` resets it and a USER declared in
// an earlier stage never reaches the runtime image. Returns null when the final stage declares none
// (i.e. the image runs as root).
export function parseDockerfileFinalUser(dockerfilePath) {
  const text = readFileSync(dockerfilePath, 'utf8');
  let user = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    if (/^FROM\s+/i.test(line)) {
      user = null;
      continue;
    }
    const match = line.match(/^USER\s+(\S+)/i);
    if (match) user = match[1];
  }
  return user;
}

// Kubernetes resolves `runAsNonRoot: true` against the image config's NUMERIC uid only; it never
// reads /etc/passwd inside the image to map a username. A named `USER node` therefore leaves the
// container in CreateContainerConfigError ("image has non-numeric user (node), cannot verify user
// is non-root") on every deployment that does not separately pin `runAsUser` — which is issue #965,
// where the executor and the workflow worker were unschedulable as shipped. Every released image
// must declare a numeric, non-zero UID so it starts under the default hardened security context.
export function collectNonRootUserViolations(catalog = readServiceCatalog()) {
  const violations = [];
  const services = Array.isArray(catalog?.services) ? catalog.services : [];

  for (const service of services.filter((entry) => entry.release === true)) {
    const image = service.imageIdentity ?? service.id;
    if (!service.dockerfile || !existsSync(service.dockerfile)) continue;

    const user = parseDockerfileFinalUser(service.dockerfile);
    if (user === null) {
      violations.push(`${image} Dockerfile ${service.dockerfile} declares no USER in its final stage; the image runs as root and cannot start under runAsNonRoot: true.`);
      continue;
    }
    // `USER <uid>[:<gid>]` — only the uid half is what kubelet checks.
    const uid = user.split(':')[0];
    if (!/^\d+$/.test(uid)) {
      violations.push(`${image} Dockerfile USER "${user}" is not a numeric UID; kubelet cannot verify runAsNonRoot and the container fails with CreateContainerConfigError (#965).`);
      continue;
    }
    if (Number(uid) === 0) {
      violations.push(`${image} Dockerfile USER "${user}" is UID 0 (root); the image cannot start under runAsNonRoot: true.`);
    }
  }

  return violations;
}

// Every `release: true` service must (a) parameterize each external `FROM` base through a build ARG
// that declares a default, and (b) record those ARGs and defaults in service-catalog.json. The
// catalog is the source of truth, so any drift between the recorded defaults and the Dockerfile ARG
// defaults — or an un-parameterized literal FROM, or a stale/missing catalog entry — is a
// deterministic violation. This lets the chart derive base-image build args from the catalog and
// lets disconnected builds override every base image (issue #929).
export function collectBaseImageArgViolations(catalog = readServiceCatalog()) {
  const violations = [];
  const services = Array.isArray(catalog?.services) ? catalog.services : [];

  for (const service of services.filter((entry) => entry.release === true)) {
    const image = service.imageIdentity ?? service.id;
    const declared = Array.isArray(service.baseImageArgs) && service.baseImageArgs.length > 0
      ? service.baseImageArgs
      : null;
    if (!declared) {
      violations.push(`${image} must record at least one baseImageArgs entry (name + default) for its Dockerfile FROM stages.`);
    }
    if (!service.dockerfile || !existsSync(service.dockerfile)) continue;

    const { argDefaults, fromRefs } = parseDockerfileBaseImages(service.dockerfile);
    if (fromRefs.length === 0) {
      violations.push(`${image} Dockerfile ${service.dockerfile} declares no FROM stage.`);
      continue;
    }

    const usedArgNames = new Set();
    for (const from of fromRefs) {
      if (from.isStageRef) continue;
      if (!from.argName) {
        violations.push(`${image} Dockerfile FROM must be overridable through a build ARG, found un-parameterized base "${from.raw}".`);
        continue;
      }
      if (!argDefaults.has(from.argName) || argDefaults.get(from.argName) == null) {
        violations.push(`${image} Dockerfile FROM references $${from.argName} but no "ARG ${from.argName}=<default>" declares a default base image.`);
        continue;
      }
      usedArgNames.add(from.argName);
    }

    if (!declared) continue;

    const declaredByName = new Map();
    for (const entry of declared) {
      if (!entry || typeof entry.name !== 'string' || typeof entry.default !== 'string') {
        violations.push(`${image} baseImageArgs entries must each declare a string "name" and string "default".`);
        continue;
      }
      declaredByName.set(entry.name, entry.default);
    }

    for (const name of usedArgNames) {
      if (!declaredByName.has(name)) {
        violations.push(`${image} Dockerfile FROM uses ARG ${name} but the catalog baseImageArgs does not record it.`);
        continue;
      }
      if (declaredByName.get(name) !== argDefaults.get(name)) {
        violations.push(`${image} baseImageArgs default for ${name} ("${declaredByName.get(name)}") drifts from the Dockerfile ARG default ("${argDefaults.get(name)}").`);
      }
    }
    for (const name of declaredByName.keys()) {
      if (!usedArgNames.has(name)) {
        violations.push(`${image} baseImageArgs records ${name} but no FROM stage in ${service.dockerfile} uses it.`);
      }
    }
  }

  return violations;
}

export function collectServiceCatalogViolations(catalog = readServiceCatalog(), matrix = readReleaseMatrix()) {
  const violations = [];
  const services = Array.isArray(catalog?.services) ? catalog.services : [];
  const releaseServices = services.filter((service) => service.release === true);
  const releaseByImage = new Map(releaseServices.map((service) => [service.imageIdentity, service]));
  const matrixImages = matrix.map((entry) => entry.image);

  if (!sameSet(matrixImages, REQUIRED_RELEASE_IMAGES)) {
    violations.push(`release workflow image matrix must remain exactly ${REQUIRED_RELEASE_IMAGES.join(', ')}.`);
  }

  if (!sameSet([...releaseByImage.keys()], matrixImages)) {
    violations.push('service catalog release entries must match the release workflow image matrix exactly.');
  }

  for (const entry of matrix) {
    const service = releaseByImage.get(entry.image);
    if (!service) continue;

    if (service.dockerfile !== entry.dockerfile) {
      violations.push(`catalog dockerfile for ${entry.image} must match release workflow (${entry.dockerfile}).`);
    }

    if (!service.source || !service.source.startsWith('apps/')) {
      violations.push(`${entry.image} source must be under apps/<service>.`);
    }

    if (service.source !== `apps/${service.id}`) {
      violations.push(`${entry.image} source must equal apps/${service.id}.`);
    }

    if (!service.dockerfile || dockerfileParent(service.dockerfile) !== service.source) {
      violations.push(`${entry.image} Dockerfile must be co-located in ${service.source}.`);
    }

    for (const path of [service.source, service.dockerfile]) {
      if (!existsSync(path)) violations.push(`${entry.image} references missing path ${path}.`);
    }

    if (!service.language) violations.push(`${entry.image} must declare a language.`);
    if (!service.chart?.alias || !service.chart?.valueKey) {
      violations.push(`${entry.image} must declare chart alias and valueKey.`);
    }
    if (!Array.isArray(service.directDependencies)) {
      violations.push(`${entry.image} directDependencies must be an array.`);
    }
    if (!Array.isArray(service.interServiceCalls) || service.interServiceCalls.length === 0) {
      violations.push(`${entry.image} interServiceCalls must be a non-empty array.`);
    }
  }

  for (const entry of matrix) {
    const context = entry.context ?? '.';
    const dockerfile = entry.dockerfile;
    if (!dockerfile?.startsWith('apps/')) {
      violations.push(`${entry.image} release Dockerfile must live under apps/: ${dockerfile}`);
      continue;
    }
    if (!existsSync(dockerfile)) continue;
    for (const line of normalizeCopyLines(readFileSync(dockerfile, 'utf8'))) {
      for (const source of splitCopyArgs(line)) {
        if (!sourceExistsInContext(source, context, entry)) {
          violations.push(`${dockerfile} COPY source does not exist in context ${context}: ${source}`);
        }
      }
    }
  }

  for (const packageName of REQUIRED_SHARED_PACKAGES) {
    if (!existsSync(`packages/${packageName}`)) {
      violations.push(`required shared package root packages/${packageName} is missing.`);
    }
  }

  for (const root of ['deploy/gateway-config', 'deploy/keycloak-config', 'tools/falcone-cli']) {
    if (!existsSync(root)) violations.push(`required moved root ${root} is missing.`);
  }

  const trackedFiles = listTrackedFiles().filter((file) => existsSync(file));
  for (const oldRoot of FORBIDDEN_OLD_ROOTS) {
    if (trackedFiles.some((file) => file === oldRoot || file.startsWith(oldRoot))) {
      violations.push(`tracked files must not remain under old root ${oldRoot}.`);
    }
  }

  const nonRelease = new Map(services.filter((service) => service.release === false).map((service) => [service.id, service]));
  for (const id of REQUIRED_NON_RELEASE_CANDIDATES) {
    const service = nonRelease.get(id);
    if (!service) {
      violations.push(`catalog must represent non-release candidate ${id}.`);
      continue;
    }
    if (service.status !== 'non_release_candidate' || service.evidenceOnly !== true) {
      violations.push(`${id} must be explicitly marked as evidence-only non_release_candidate.`);
    }
    if (service.imageIdentity || service.chart) {
      violations.push(`${id} must not claim a release image or chart image value.`);
    }
    if (!service.source?.startsWith('packages/') || !existsSync(service.source)) {
      violations.push(`${id} must reference an existing packages/<name> source.`);
    }
  }

  const legacyConsole = catalog?.legacyNonDeployable?.find((entry) => entry.id === 'console');
  if (!legacyConsole || legacyConsole.source !== 'apps/console' || legacyConsole.status !== 'legacy_non_deployable') {
    violations.push('apps/console must be cataloged as legacy_non_deployable.');
  }

  const routeMap = readJson('apps/control-plane/route-map.runtime.json');
  for (const route of routeMap) {
    if (!route?.module || route.module === 'NONE') continue;
    const modulePath = route.module.startsWith('/repo/') ? route.module.slice('/repo/'.length) : route.module;
    if (!existsSync(modulePath)) {
      violations.push(`route-map runtime module for ${route.method} ${route.path} does not exist: ${route.module}`);
    }
  }

  violations.push(...collectBaseImageArgViolations(catalog));
  violations.push(...collectNonRootUserViolations(catalog));

  return violations;
}

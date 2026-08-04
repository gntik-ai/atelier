/**
 * bbx-c06-001 | fn-gateway-prometheus-scrape
 * OpenSpec #### Scenario: Gateway serves APISIX Prometheus metrics on its public metrics path
 *
 * Black-box boundary: the shipped standalone APISIX configuration, the public Docker
 * image entrypoint, Docker's published-port contract, and the gateway HTTP endpoint.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const APISIX_IMAGE = 'apache/apisix:3.10.0-debian';
const METRICS_PATH = '/apisix/prometheus/metrics';
const CONFIG_PATH = resolve('deploy/kind/apisix/apisix.yaml');
const CONTAINER_CONFIG_PATH = '/usr/local/apisix/conf/apisix.yaml';
const APISIX_METRIC_FAMILY = /^(?:#\s+(?:HELP|TYPE)\s+)?apisix_[A-Za-z_:][A-Za-z0-9_:]*/m;

function routeBlocks(source) {
  const lines = source.split(/\r?\n/);
  const starts = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (/^  - id:/.test(lines[index])) starts.push(index);
  }

  return starts.map((start, index) => {
    const nextRoute = starts[index + 1] ?? lines.length;
    const globalRules = lines.findIndex(
      (line, lineIndex) => lineIndex > start && /^global_rules:/.test(line),
    );
    const end = globalRules !== -1 && globalRules < nextRoute ? globalRules : nextRoute;
    return lines.slice(start, end).join('\n');
  });
}

function runDocker(args, options = {}) {
  return spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: 15_000,
    ...options,
  });
}

function dockerSkipReason() {
  const probe = runDocker(['info', '--format', '{{.ServerVersion}}']);
  if (probe.error?.code === 'ENOENT') return 'Docker CLI is not installed';
  if (probe.status !== 0) return 'Docker daemon is unavailable';
  return undefined;
}

function commandFailure(command, result) {
  const detail = (result.stderr || result.stdout || result.error?.message || 'no output')
    .trim()
    .slice(0, 500);
  return `${command} failed (exit ${String(result.status)}): ${detail}`;
}

function uniqueContainerName(label) {
  return `falcone-bbx-c06-${label}-${process.pid}-${randomBytes(6).toString('hex')}`;
}

function removeContainer(containerName) {
  const removed = runDocker(['rm', '--force', containerName]);
  if (removed.status !== 0 && !/No such container/i.test(removed.stderr)) {
    throw new Error(commandFailure('docker rm --force', removed));
  }
}

function assertLocalImageAvailable() {
  const localImage = runDocker(['image', 'inspect', APISIX_IMAGE, '--format', '{{.Id}}']);
  assert.equal(
    localImage.status,
    0,
    `acceptance test requires the preloaded ${APISIX_IMAGE} image and never pulls from the network; ${commandFailure('docker image inspect', localImage)}`,
  );
}

function startApisix(containerName, configPath) {
  const started = runDocker([
    'run',
    '--detach',
    '--rm',
    '--pull=never',
    '--name',
    containerName,
    '--env',
    'APISIX_STAND_ALONE=true',
    '--env',
    'GATEWAY_SHARED_SECRET=c06-local-placeholder',
    '--publish',
    '127.0.0.1::9080',
    '--volume',
    `${configPath}:${CONTAINER_CONFIG_PATH}:ro`,
    APISIX_IMAGE,
  ]);
  assert.equal(started.status, 0, commandFailure('docker run', started));
}

function publishedGatewayPort(containerName) {
  const bindingResult = runDocker([
    'inspect',
    '--format',
    '{{json .HostConfig.PortBindings}}',
    containerName,
  ]);
  assert.equal(bindingResult.status, 0, commandFailure('docker inspect', bindingResult));
  const bindings = JSON.parse(bindingResult.stdout.trim());
  assert.deepEqual(
    Object.keys(bindings),
    ['9080/tcp'],
    'only the public gateway port may be published; exporter port 9091 stays internal',
  );
  assert.equal(bindings['9080/tcp'].length, 1);
  assert.equal(bindings['9080/tcp'][0].HostIp, '127.0.0.1');

  const publishedResult = runDocker([
    'inspect',
    '--format',
    '{{json .NetworkSettings.Ports}}',
    containerName,
  ]);
  assert.equal(publishedResult.status, 0, commandFailure('docker inspect', publishedResult));
  const published = JSON.parse(publishedResult.stdout.trim());
  const externallyReachable = Object.entries(published)
    .filter(([, addresses]) => addresses !== null)
    .map(([containerPort]) => containerPort);
  assert.deepEqual(
    externallyReachable,
    ['9080/tcp'],
    'the dedicated exporter port 9091 must not be externally reachable',
  );
  assert.equal(published['9080/tcp'].length, 1);
  assert.equal(published['9080/tcp'][0].HostIp, '127.0.0.1');
  assert.match(published['9080/tcp'][0].HostPort, /^\d+$/);
  return published['9080/tcp'][0].HostPort;
}

function createTemporaryConfig(t, label, source, containerName) {
  const directory = mkdtempSync(join(tmpdir(), `falcone-bbx-c06-${label}-`));
  const configPath = join(directory, 'apisix.yaml');

  t.after(() => {
    let containerError;
    try {
      removeContainer(containerName);
    } catch (error) {
      containerError = error;
    }
    rmSync(directory, { recursive: true, force: true });
    if (containerError) throw containerError;
  });

  writeFileSync(configPath, source, { encoding: 'utf8', mode: 0o644 });
  return configPath;
}

function replaceMetricsRoute(source, replacement) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => /^  - id:\s*["']1011-metrics["']\s*$/.test(line));
  assert.notEqual(start, -1, 'expected standalone route 1011-metrics');
  const following = lines.findIndex((line, index) => index > start && /^  - id:/.test(line));
  assert.notEqual(following, -1, 'expected a route after 1011-metrics');
  return [...lines.slice(0, start), ...replacement.split('\n'), ...lines.slice(following)].join('\n');
}

async function waitForMetrics(url, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  let lastResponse;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'text/plain' },
        signal: AbortSignal.timeout(2_000),
      });
      const body = await response.text();
      lastResponse = {
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
        body,
      };
      if (response.status === 200) return lastResponse;
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }

  if (lastResponse) return lastResponse;
  throw new Error(`gateway did not become reachable: ${lastError?.message ?? 'no HTTP response'}`);
}

async function waitForStatus(url, isExpected, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  let lastResponse;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'text/plain' },
        signal: AbortSignal.timeout(2_000),
      });
      lastResponse = {
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
        body: await response.text(),
      };
      if (isExpected(lastResponse.status)) return lastResponse;
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }

  if (lastResponse) return lastResponse;
  throw new Error(`gateway did not become reachable: ${lastError?.message ?? 'no HTTP response'}`);
}

function responseSummary(response) {
  const preview = response.body.replace(/\s+/g, ' ').trim().slice(0, 240);
  return `status=${response.status}, content-type=${JSON.stringify(response.contentType)}, body=${JSON.stringify(preview)}`;
}

async function requestGateway(url, method) {
  const response = await fetch(url, {
    method,
    headers: { accept: 'text/plain' },
    signal: AbortSignal.timeout(3_000),
  });
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    body: await response.text(),
  };
}

function isExporterResponse(response) {
  return (
    response.status === 200 &&
    /^text\/plain(?:;|$)/i.test(response.contentType) &&
    APISIX_METRIC_FAMILY.test(response.body)
  );
}

// bbx-c06-001 | fn-gateway-prometheus-scrape
// OpenSpec #### Scenario: Gateway serves APISIX Prometheus metrics on its public metrics path
test(
  'bbx-c06-001 | fn-gateway-prometheus-scrape | standalone route keeps the exporter internal',
  () => {
    const source = readFileSync(CONFIG_PATH, 'utf8');
    const metricsRoutes = routeBlocks(source).filter((block) =>
      /^    uri:\s*["']\/apisix\/prometheus\/metrics["']\s*$/m.test(block),
    );

    assert.equal(metricsRoutes.length, 1, `expected exactly one route for ${METRICS_PATH}`);
    const route = metricsRoutes[0];
    assert.match(route, /^    methods:\s*\[\s*["']GET["']\s*\]\s*$/m);
    assert.match(
      route,
      /^        ["']127\.0\.0\.1:9091["']:\s*1\s*$/m,
      'metrics route must proxy to the APISIX exporter over container loopback',
    );
    assert.doesNotMatch(
      route,
      /^      public-api:/m,
      'the public-api plugin does not serve the dedicated Prometheus exporter in standalone mode',
    );
  },
);

const unavailableReason = dockerSkipReason();

// bbx-c06-001 | fn-gateway-prometheus-scrape
// OpenSpec #### Scenario: Gateway serves APISIX Prometheus metrics on its public metrics path
test(
  'bbx-c06-001 | fn-gateway-prometheus-scrape | GET exposes APISIX metrics through only the gateway port',
  {
    skip: unavailableReason,
    timeout: 45_000,
  },
  async (t) => {
    const localImage = runDocker(['image', 'inspect', APISIX_IMAGE, '--format', '{{.Id}}']);
    assert.equal(
      localImage.status,
      0,
      `acceptance test requires the preloaded ${APISIX_IMAGE} image and never pulls from the network; ${commandFailure('docker image inspect', localImage)}`,
    );

    const suffix = `${process.pid}-${randomBytes(6).toString('hex')}`;
    const containerName = `falcone-bbx-c06-${suffix}`;
    t.after(() => {
      const removed = runDocker(['rm', '--force', containerName]);
      if (removed.status !== 0 && !/No such container/i.test(removed.stderr)) {
        throw new Error(commandFailure('docker rm --force', removed));
      }
    });

    const started = runDocker([
      'run',
      '--detach',
      '--rm',
      '--pull=never',
      '--name',
      containerName,
      '--env',
      'APISIX_STAND_ALONE=true',
      '--env',
      'GATEWAY_SHARED_SECRET=c06-local-placeholder',
      '--publish',
      '127.0.0.1::9080',
      '--volume',
      `${CONFIG_PATH}:${CONTAINER_CONFIG_PATH}:ro`,
      APISIX_IMAGE,
    ]);
    assert.equal(started.status, 0, commandFailure('docker run', started));

    const bindingResult = runDocker([
      'inspect',
      '--format',
      '{{json .HostConfig.PortBindings}}',
      containerName,
    ]);
    assert.equal(bindingResult.status, 0, commandFailure('docker inspect', bindingResult));
    const bindings = JSON.parse(bindingResult.stdout.trim());
    assert.deepEqual(
      Object.keys(bindings),
      ['9080/tcp'],
      'only the public gateway port may be published; exporter port 9091 stays internal',
    );
    assert.equal(bindings['9080/tcp'].length, 1);
    assert.equal(bindings['9080/tcp'][0].HostIp, '127.0.0.1');

    const publishedResult = runDocker([
      'inspect',
      '--format',
      '{{json .NetworkSettings.Ports}}',
      containerName,
    ]);
    assert.equal(publishedResult.status, 0, commandFailure('docker inspect', publishedResult));
    const published = JSON.parse(publishedResult.stdout.trim());
    const externallyReachable = Object.entries(published)
      .filter(([, addresses]) => addresses !== null)
      .map(([containerPort]) => containerPort);
    assert.deepEqual(
      externallyReachable,
      ['9080/tcp'],
      'the dedicated exporter port 9091 must not be externally reachable',
    );
    assert.equal(published['9080/tcp'].length, 1);
    assert.equal(published['9080/tcp'][0].HostIp, '127.0.0.1');
    assert.match(published['9080/tcp'][0].HostPort, /^\d+$/);

    const hostPort = published['9080/tcp'][0].HostPort;
    const response = await waitForMetrics(`http://127.0.0.1:${hostPort}${METRICS_PATH}`);
    const summary = responseSummary(response);

    assert.equal(response.status, 200, `metrics endpoint must be scrapeable: ${summary}`);
    assert.match(
      response.contentType,
      /^text\/plain(?:;|$)/i,
      `metrics endpoint must return Prometheus text format: ${summary}`,
    );
    assert.match(
      response.body,
      APISIX_METRIC_FAMILY,
      'metrics endpoint must expose at least one apisix_ metric family',
    );

    const negativeRequests = [
      ['POST', METRICS_PATH],
      ['GET', '/apisix/prometheus/metricz'],
    ];
    for (const [method, path] of negativeRequests) {
      const negativeResponse = await requestGateway(`http://127.0.0.1:${hostPort}${path}`, method);
      assert.equal(
        isExporterResponse(negativeResponse),
        false,
        `${method} ${path} must not reach the metrics exporter: ${responseSummary(negativeResponse)}`,
      );
    }
  },
);

// bbx-c06-002 | fn-gateway-prometheus-scrape
// OpenSpec #### Scenario: Exporter failure is bounded and sanitized
test(
  'bbx-c06-002 | fn-gateway-prometheus-scrape | unavailable loopback exporter fails bounded and sanitized',
  {
    skip: unavailableReason,
    timeout: 30_000,
  },
  async (t) => {
    const source = readFileSync(CONFIG_PATH, 'utf8');
    const unavailablePort = 45_000 + (randomBytes(2).readUInt16BE(0) % 15_000);
    const exporterNode = /^        ["']127\.0\.0\.1:9091["']:\s*1\s*$/m;
    assert.match(source, exporterNode, 'source config must use the dedicated loopback exporter');
    const derivedSource = source.replace(
      exporterNode,
      `        "127.0.0.1:${unavailablePort}": 1`,
    );
    assert.notEqual(derivedSource, source, 'derived config must redirect only the exporter upstream');

    const containerName = uniqueContainerName('exporter-down');
    const temporaryConfig = createTemporaryConfig(
      t,
      'exporter-down',
      derivedSource,
      containerName,
    );
    assertLocalImageAvailable();
    startApisix(containerName, temporaryConfig);
    const hostPort = publishedGatewayPort(containerName);

    const startedAt = Date.now();
    const response = await waitForStatus(
      `http://127.0.0.1:${hostPort}${METRICS_PATH}`,
      (status) => status >= 500 && status <= 599,
    );
    const elapsedMs = Date.now() - startedAt;
    const summary = responseSummary(response);

    assert.match(String(response.status), /^5\d\d$/, `exporter failure must return 5xx: ${summary}`);
    assert.ok(elapsedMs < 8_500, `exporter failure exceeded the 8.5s bound (${elapsedMs}ms)`);
    assert.doesNotMatch(
      response.body,
      new RegExp(`127\\.0\\.0\\.1|localhost|${unavailablePort}`, 'i'),
      'error body must not disclose the internal exporter address',
    );
    assert.doesNotMatch(
      response.body,
      /c06-local-placeholder|GATEWAY_SHARED_SECRET|stack\s*trace|traceback|\/usr\/local\/apisix|\.lua:\d+/i,
      'error body must not disclose secrets, stack traces, or runtime paths',
    );
  },
);

// bbx-c06-003 | fn-gateway-prometheus-scrape
// OpenSpec #### Scenario: Rollback restores the previous non-scrapeable route
test(
  'bbx-c06-003 | fn-gateway-prometheus-scrape | rollback reopens the prior scrape loss without publishing exporter port',
  {
    skip: unavailableReason,
    timeout: 30_000,
  },
  async (t) => {
    const source = readFileSync(CONFIG_PATH, 'utf8');
    const rollbackRoute = [
      '  - id: "1011-metrics"',
      `    uri: "${METRICS_PATH}"`,
      '    priority: 400',
      '    methods: ["GET"]',
      '    plugins:',
      '      public-api: {}',
    ].join('\n');
    const rollbackSource = replaceMetricsRoute(source, rollbackRoute);
    assert.match(
      rollbackSource,
      /^global_rules:\n(?:.|\n)*?^      prometheus:/m,
      'rollback changes only route 1011-metrics and leaves the exporter runtime enabled',
    );

    const containerName = uniqueContainerName('rollback');
    const temporaryConfig = createTemporaryConfig(
      t,
      'rollback',
      rollbackSource,
      containerName,
    );
    assertLocalImageAvailable();
    startApisix(containerName, temporaryConfig);
    const hostPort = publishedGatewayPort(containerName);

    const response = await waitForStatus(
      `http://127.0.0.1:${hostPort}${METRICS_PATH}`,
      (status) => status === 404,
    );
    assert.equal(
      response.status,
      404,
      `rolling route 1011-metrics back must reproduce the prior non-scrapeable response: ${responseSummary(response)}`,
    );
    assert.match(response.body, /404 (?:Route )?Not Found/i);
  },
);

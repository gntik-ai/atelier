import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const IMMUTABLE = 'public, max-age=31536000, immutable';
const FAVICON_MAX_BYTES = 10 * 1024;
const REFERRER_POLICY = 'strict-origin-when-cross-origin';
const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';
const BAD_REQUEST_BODY = 'Bad Request';

const staticServers = [
  {
    name: 'deploy kind static server',
    script: 'apps/web-console/static-server.mjs'
  },
  {
    name: 'app static server',
    script: 'apps/web-console/static-server.mjs'
  }
];

async function createDistRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'falcone-web-console-static-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'assets'));

  const files = {
    '/index.html': '<!doctype html><main id="root">Falcone</main>',
    '/assets/app.4f3c2a1b.js': `const payload = ${JSON.stringify('falcone-console-js;'.repeat(4096))};\nconsole.log(payload.length);\n`,
    '/assets/theme.9a8b7c6d.css': `.console-shell { color: #111827; background: #f8fafc; }\n${'.grid-row { display: grid; gap: 8px; }\n'.repeat(2048)}`,
    '/assets/config.aabbccdd.json': JSON.stringify({ feature: 'static-delivery', values: Array(1024).fill('cache-compress') }),
    '/assets/logo.0f1e2d3c.svg': `<svg xmlns="http://www.w3.org/2000/svg">${'<path d="M0 0h10v10H0z"/>'.repeat(1024)}</svg>`,
    '/assets/encoded path.13579bdf.js': `const encodedPath = ${JSON.stringify('valid-percent-path;'.repeat(2048))};\n`,
    '/assets/icon.01020304.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00])
  };

  await Promise.all(Object.entries(files).map(([path, body]) => writeFile(join(root, path), body)));
  return { root, files };
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
  try {
    await once(child, 'exit');
  } finally {
    clearTimeout(timer);
  }
}

function startStaticServer(t, script, root, extraEnv = {}) {
  const child = spawn(process.execPath, [script], {
    cwd: repoRoot,
    env: {
      ...process.env,
      WEB_CONSOLE_STATIC_ROOT: root,
      PORT: '0',
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => stopProcess(child));

  return new Promise((resolveReady, rejectReady) => {
    let settled = false;
    const output = { stdout: '', stderr: '' };
    const timer = setTimeout(
      () => finish(new Error(`Timed out waiting for ${script} to listen. stderr: ${output.stderr}`)),
      5000
    );

    function finish(error, port) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectReady(error);
      else resolveReady({ child, port, output });
    }

    child.stdout.on('data', (chunk) => {
      output.stdout += String(chunk);
      const match = output.stdout.match(/web-console static server on :(\d+)/);
      if (match) finish(null, Number(match[1]));
    });
    child.stderr.on('data', (chunk) => {
      output.stderr += String(chunk);
    });
    child.on('exit', (code, signal) => {
      finish(new Error(`${script} exited before listening: code=${code} signal=${signal} stderr=${output.stderr}`));
    });
    child.on('error', finish);
  });
}

function request(port, path, { method = 'GET', headers = {}, body, timeoutMs = 3000 } = {}) {
  return new Promise((resolveResponse, rejectResponse) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolveResponse({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks)
          });
        });
        res.on('aborted', () => rejectResponse(new Error(`Response aborted for ${method} ${path}`)));
        res.on('error', rejectResponse);
      }
    );
    req.on('error', rejectResponse);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timed out requesting ${method} ${path}`)));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function assertCompressed(response, encoding, rawBody) {
  assert.equal(response.statusCode, 200);
  assertSecurityHeaders(response.headers, `${encoding} compressed asset`);
  assert.equal(response.headers['content-encoding'], encoding);
  assert.equal(response.headers['cache-control'], IMMUTABLE);
  assert.match(response.headers.vary ?? '', /Accept-Encoding/i);
  assert.ok(
    response.body.length < Buffer.byteLength(rawBody) * 0.5,
    `expected ${encoding} response to be materially smaller than raw bytes`
  );

  const decompressed = encoding === 'br' ? brotliDecompressSync(response.body) : gunzipSync(response.body);
  assert.equal(decompressed.toString('utf8'), rawBody);
}

function parseCsp(header) {
  return new Map(
    header
      .split(';')
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...values] = directive.split(/\s+/);
        return [name.toLowerCase(), values];
      })
  );
}

function assertSecurityHeaders(headers, label = 'response') {
  assert.ok(headers['content-security-policy'], `${label} includes Content-Security-Policy`);
  assert.equal(headers['x-frame-options'], 'DENY', `${label} denies framing via X-Frame-Options`);
  assert.equal(headers['x-content-type-options'], 'nosniff', `${label} disables content sniffing`);
  assert.equal(headers['referrer-policy'], REFERRER_POLICY, `${label} sets a referrer policy`);
  assert.equal(headers['permissions-policy'], PERMISSIONS_POLICY, `${label} sets a permissions policy`);

  const csp = parseCsp(headers['content-security-policy']);
  assert.deepEqual(csp.get('frame-ancestors'), ["'none'"], `${label} denies all framing via CSP`);
  assert.deepEqual(csp.get('script-src'), ["'self'"], `${label} constrains scripts to self`);
  assert.deepEqual(csp.get('default-src'), ["'self'"], `${label} constrains default loads to self`);
  assert.deepEqual(csp.get('object-src'), ["'none'"], `${label} disables plugin/object execution`);
  assert.deepEqual(csp.get('base-uri'), ["'self'"], `${label} constrains base URI mutation`);
  assert.deepEqual(csp.get('connect-src'), ["'self'"], `${label} keeps console API traffic same-origin`);
  assert.deepEqual(csp.get('form-action'), ["'self'"], `${label} constrains form submissions`);

  const scriptSrc = csp.get('script-src') ?? [];
  assert.ok(!scriptSrc.includes("'unsafe-inline'"), `${label} does not allow inline scripts`);
  assert.ok(!scriptSrc.includes("'unsafe-eval'"), `${label} does not allow eval-like script execution`);
  assert.ok(!scriptSrc.includes('*'), `${label} does not allow wildcard script origins`);
}

function assertNginxSecurityHeaderSource(source, name, scope) {
  assert.match(
    source,
    /add_header\s+Content-Security-Policy\s+"[^"]*frame-ancestors 'none'[^"]*script-src 'self'[^"]*"\s+always;/,
    `${name} ${scope} declares CSP with frame denial and self-only scripts`
  );
  assert.match(source, /add_header\s+X-Frame-Options\s+"DENY"\s+always;/, `${name} ${scope} denies framing`);
  assert.match(source, /add_header\s+X-Content-Type-Options\s+"nosniff"\s+always;/, `${name} ${scope} disables sniffing`);
  assert.match(
    source,
    /add_header\s+Referrer-Policy\s+"strict-origin-when-cross-origin"\s+always;/,
    `${name} ${scope} declares referrer policy`
  );
  assert.match(source, /add_header\s+Permissions-Policy\s+"[^"]+"\s+always;/, `${name} ${scope} declares permissions policy`);
}

function extractNginxLocation(source, pattern, name, scope) {
  const match = source.match(pattern);
  assert.ok(match, `${name} declares ${scope}`);
  return match[1];
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseLinkAttributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/\s([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((match) => [
      match[1].toLowerCase(),
      match[2] ?? match[3] ?? ''
    ])
  );
}

test('web console declares a lightweight SVG-capable favicon asset', async () => {
  const indexHtml = await readFile(join(repoRoot, 'apps/web-console/index.html'), 'utf8');
  const iconLinks = [...indexHtml.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => parseLinkAttributes(match[0]))
    .filter((attributes) => (attributes.rel ?? '').split(/\s+/).includes('icon'));

  assert.ok(iconLinks.length > 0, 'index.html declares at least one favicon');

  const primaryIcon = iconLinks.find((attributes) => attributes.type === 'image/svg+xml') ?? iconLinks[0];
  assert.ok(primaryIcon.href, 'primary favicon declares an href');
  assert.match(primaryIcon.href, /^\//, 'primary favicon uses an app-root public path');

  const assetPath = join(repoRoot, 'apps/web-console/public', primaryIcon.href.slice(1));
  const assetStats = await stat(assetPath);
  assert.ok(
    assetStats.size <= FAVICON_MAX_BYTES,
    `expected ${primaryIcon.href} to be <= ${FAVICON_MAX_BYTES} bytes, got ${assetStats.size}`
  );

  if ((primaryIcon.type ?? '').includes('svg') || primaryIcon.href.endsWith('.svg')) {
    const faviconSvg = await readFile(assetPath, 'utf8');
    assert.match(faviconSvg, /<svg\b/i, 'SVG favicon is an SVG document');
    assert.doesNotMatch(
      faviconSvg,
      /href\s*=\s*["']data:image\/(?:png|jpe?g|gif|webp);base64,/i,
      'SVG favicon must not embed a raster image as a base64 data URL'
    );
  }
});

for (const server of staticServers) {
  test(`${server.name} compresses assets and sets cache and security headers`, async (t) => {
    const { root, files } = await createDistRoot(t);
    const { port } = await startStaticServer(t, server.script, root);

    const brJs = await request(port, '/assets/app.4f3c2a1b.js', {
      headers: { 'accept-encoding': 'gzip, br' }
    });
    assertCompressed(brJs, 'br', files['/assets/app.4f3c2a1b.js']);

    const gzipCss = await request(port, '/assets/theme.9a8b7c6d.css', {
      headers: { 'accept-encoding': 'br;q=0, gzip' }
    });
    assertCompressed(gzipCss, 'gzip', files['/assets/theme.9a8b7c6d.css']);

    const gzipJson = await request(port, '/assets/config.aabbccdd.json', {
      headers: { 'accept-encoding': 'gzip' }
    });
    assertCompressed(gzipJson, 'gzip', files['/assets/config.aabbccdd.json']);

    const gzipSvg = await request(port, '/assets/logo.0f1e2d3c.svg', {
      headers: { 'accept-encoding': 'gzip' }
    });
    assertCompressed(gzipSvg, 'gzip', files['/assets/logo.0f1e2d3c.svg']);

    const png = await request(port, '/assets/icon.01020304.png', {
      headers: { 'accept-encoding': 'br, gzip' }
    });
    assert.equal(png.statusCode, 200);
    assertSecurityHeaders(png.headers, `${server.name} PNG asset`);
    assert.equal(png.headers['cache-control'], IMMUTABLE);
    assert.equal(png.headers['content-encoding'], undefined);
    assert.equal(png.headers.vary, undefined);
    assert.deepEqual(png.body, files['/assets/icon.01020304.png']);

    const rootResponse = await request(port, '/');
    assert.equal(rootResponse.statusCode, 200);
    assertSecurityHeaders(rootResponse.headers, `${server.name} root shell`);
    assert.equal(rootResponse.headers['cache-control'], 'no-store');
    assert.equal(rootResponse.body.toString('utf8'), files['/index.html']);

    const index = await request(port, '/index.html', {
      headers: { 'accept-encoding': 'br, gzip' }
    });
    assert.equal(index.statusCode, 200);
    assertSecurityHeaders(index.headers, `${server.name} index shell`);
    assert.equal(index.headers['cache-control'], 'no-store');
    assert.equal(index.headers['content-encoding'], undefined);
    assert.equal(index.body.toString('utf8'), files['/index.html']);

    const login = await request(port, '/login');
    assert.equal(login.statusCode, 200);
    assertSecurityHeaders(login.headers, `${server.name} /login SPA fallback`);
    assert.equal(login.headers['cache-control'], 'no-store');
    assert.equal(login.body.toString('utf8'), files['/index.html']);

    const spaFallback = await request(port, '/console/workspaces/demo');
    assert.equal(spaFallback.statusCode, 200);
    assertSecurityHeaders(spaFallback.headers, `${server.name} SPA fallback`);
    assert.equal(spaFallback.headers['cache-control'], 'no-store');
    assert.equal(spaFallback.body.toString('utf8'), files['/index.html']);

    const healthz = await request(port, '/healthz');
    assert.equal(healthz.statusCode, 200);
    assert.equal(healthz.body.toString('utf8'), 'ok');
  });
}

test('shared static server contains malformed paths and preserves same-process static and proxy behavior', { timeout: 15000 }, async (t) => {
  const upstreamRequests = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const requestBody = Buffer.concat(chunks).toString('utf8');
      upstreamRequests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: requestBody
      });
      const responseBody = JSON.stringify({
        proxied: true,
        method: req.method,
        target: req.url,
        requestBody
      });
      res.writeHead(207, {
        'content-type': 'application/json',
        'content-language': 'en',
        'x-upstream-result': 'preserved'
      });
      res.end(responseBody);
    });
  });
  await new Promise((resolveListen) => upstream.listen(0, '127.0.0.1', resolveListen));
  t.after(() => new Promise((resolveClose) => upstream.close(resolveClose)));

  const upstreamAddress = upstream.address();
  const { root, files } = await createDistRoot(t);
  const { child, port, output } = await startStaticServer(t, 'apps/web-console/static-server.mjs', root, {
    GATEWAY_UPSTREAM: `127.0.0.1:${upstreamAddress.port}`
  });
  const originalPid = child.pid;

  for (const malformedPath of ['/%ZZ', '/%', '/%C3%28']) {
    const response = await request(port, malformedPath);
    assert.equal(response.statusCode, 400, `${malformedPath} is a client error`);
    assert.equal(response.headers['content-type'], 'text/plain; charset=utf-8');
    assert.equal(response.headers['content-length'], String(Buffer.byteLength(BAD_REQUEST_BODY)));
    assert.equal(response.body.toString('utf8'), BAD_REQUEST_BODY);
    assert.ok(!response.body.toString('utf8').includes(malformedPath), `${malformedPath} is not reflected`);
    assert.ok(!response.body.toString('utf8').includes(root), `${malformedPath} does not expose the static root`);
    assert.doesNotMatch(
      response.body.toString('utf8'),
      /Falcone|URIError|decodeURIComponent|stack|credential|tenant|workspace/i,
      `${malformedPath} does not expose static, runtime, credential, or tenant details`
    );
  }

  assert.equal(child.pid, originalPid, 'the child PID does not change after sequential malformed requests');
  assert.equal(child.exitCode, null, 'the child does not exit after sequential malformed requests');
  assert.doesNotThrow(() => process.kill(originalPid, 0), 'the original child PID remains alive');

  const healthz = await request(port, '/healthz');
  assert.equal(healthz.statusCode, 200);
  assert.equal(healthz.body.toString('utf8'), 'ok');

  const rootResponse = await request(port, '/');
  assert.equal(rootResponse.statusCode, 200);
  assertSecurityHeaders(rootResponse.headers, 'same-PID root shell');
  assert.equal(rootResponse.headers['cache-control'], 'no-store');
  assert.equal(rootResponse.body.toString('utf8'), files['/index.html']);

  const asset = await request(port, '/assets/app.4f3c2a1b.js');
  assert.equal(asset.statusCode, 200);
  assertSecurityHeaders(asset.headers, 'same-PID static asset');
  assert.equal(asset.headers['cache-control'], IMMUTABLE);
  assert.equal(asset.body.toString('utf8'), files['/assets/app.4f3c2a1b.js']);

  const spaFallback = await request(port, '/console/workspaces/after-malformed');
  assert.equal(spaFallback.statusCode, 200);
  assertSecurityHeaders(spaFallback.headers, 'same-PID SPA fallback');
  assert.equal(spaFallback.headers['cache-control'], 'no-store');
  assert.equal(spaFallback.body.toString('utf8'), files['/index.html']);

  const encodedAsset = await request(port, '/assets/encoded%20path.13579bdf.js', {
    headers: { 'accept-encoding': 'gzip' }
  });
  assertCompressed(encodedAsset, 'gzip', files['/assets/encoded path.13579bdf.js']);

  const malformedAssetQuery = await request(port, '/assets/app.4f3c2a1b.js?filter=%ZZ&trailing=%');
  assert.equal(malformedAssetQuery.statusCode, 200);
  assertSecurityHeaders(malformedAssetQuery.headers, 'asset with malformed query syntax');
  assert.equal(malformedAssetQuery.headers['cache-control'], IMMUTABLE);
  assert.equal(malformedAssetQuery.body.toString('utf8'), files['/assets/app.4f3c2a1b.js']);

  const malformedSpaQuery = await request(port, '/console/query-only?filter=%ZZ&trailing=%');
  assert.equal(malformedSpaQuery.statusCode, 200);
  assertSecurityHeaders(malformedSpaQuery.headers, 'SPA route with malformed query syntax');
  assert.equal(malformedSpaQuery.headers['cache-control'], 'no-store');
  assert.equal(malformedSpaQuery.body.toString('utf8'), files['/index.html']);

  const exactV1 = await request(port, '/v1');
  assert.equal(exactV1.statusCode, 207, 'exact /v1 remains in the proxy branch');

  const proxyBody = JSON.stringify({ operation: 'malformed-path-boundary' });
  const rawProxyPath = '/v1/%ZZ?query=%&mode=raw';
  const proxyResponse = await request(port, rawProxyPath, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(proxyBody),
      'x-correlation-id': 'static-server-boundary',
      'x-test': 'proxy-preserved'
    },
    body: proxyBody
  });

  assert.equal(proxyResponse.statusCode, 207);
  assert.equal(proxyResponse.headers['content-type'], 'application/json');
  assert.equal(proxyResponse.headers['content-language'], 'en');
  assert.equal(proxyResponse.headers['x-upstream-result'], 'preserved');
  assert.deepEqual(JSON.parse(proxyResponse.body.toString('utf8')), {
    proxied: true,
    method: 'POST',
    target: rawProxyPath,
    requestBody: proxyBody
  });

  assert.equal(upstreamRequests.length, 2);
  assert.equal(upstreamRequests[0].method, 'GET');
  assert.equal(upstreamRequests[0].url, '/v1');
  assert.equal(upstreamRequests[1].method, 'POST');
  assert.equal(upstreamRequests[1].url, rawProxyPath);
  assert.equal(upstreamRequests[1].headers.host, `127.0.0.1:${upstreamAddress.port}`);
  assert.equal(upstreamRequests[1].headers['content-type'], 'application/json');
  assert.equal(upstreamRequests[1].headers['content-length'], String(Buffer.byteLength(proxyBody)));
  assert.equal(upstreamRequests[1].headers['x-correlation-id'], 'static-server-boundary');
  assert.equal(upstreamRequests[1].headers['x-test'], 'proxy-preserved');
  assert.equal(upstreamRequests[1].body, proxyBody);

  await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  assert.equal(child.pid, originalPid, 'the proxy and recovery requests use the original child PID');
  assert.equal(child.exitCode, null, 'the child remains available after all recovery requests');
  assert.equal(output.stderr, '', 'malformed requests emit no uncaught exception or rejection');
});

test('shared static server preserves the focused gateway-unreachable response', async (t) => {
  const portProbe = http.createServer();
  await new Promise((resolveListen) => portProbe.listen(0, '127.0.0.1', resolveListen));
  const unavailableAddress = portProbe.address();
  await new Promise((resolveClose) => portProbe.close(resolveClose));

  const { root } = await createDistRoot(t);
  const { child, port } = await startStaticServer(t, 'apps/web-console/static-server.mjs', root, {
    GATEWAY_UPSTREAM: `127.0.0.1:${unavailableAddress.port}`
  });

  const response = await request(port, '/v1/unreachable');
  assert.equal(response.statusCode, 502);
  assert.equal(response.headers['content-type'], 'application/json');
  assert.equal(JSON.parse(response.body.toString('utf8')).code, 'GATEWAY_UNREACHABLE');
  assert.equal(child.exitCode, null, 'gateway failure does not terminate the shared server');

  const healthz = await request(port, '/healthz');
  assert.equal(healthz.statusCode, 200);
  assert.equal(healthz.body.toString('utf8'), 'ok');
});

test('legacy nginx static-serving configs declare gzip, cache-control, and security-header parity', async () => {
  const configs = [
    {
      name: 'production web-console nginx',
      path: 'apps/web-console/nginx.conf',
      requiresHealthz: false
    },
    {
      name: 'kind web-console nginx',
      path: 'deploy/kind/web-console/nginx.conf',
      requiresHealthz: true
    }
  ];

  for (const config of configs) {
    const source = await readFile(join(repoRoot, config.path), 'utf8');
    const indexLocation = extractNginxLocation(
      source,
      /location\s+=\s+\/index\.html\s*\{([\s\S]*?)\n\s*\}/,
      config.name,
      'index.html location'
    );
    assertNginxSecurityHeaderSource(indexLocation, config.name, 'index.html location');

    const assetsLocation = extractNginxLocation(
      source,
      /location\s+\/assets\/\s*\{([\s\S]*?)\n\s*\}/,
      config.name,
      'assets location'
    );
    assertNginxSecurityHeaderSource(assetsLocation, config.name, 'assets location');

    const shellLocation = extractNginxLocation(
      source,
      /location\s+\/\s*\{([\s\S]*?)\n\s*\}/,
      config.name,
      'SPA shell fallback location'
    );
    assertNginxSecurityHeaderSource(shellLocation, config.name, 'SPA shell fallback location');

    assert.match(source, /gzip\s+on;/, `${config.name} enables gzip`);
    assert.match(source, /gzip_vary\s+on;/, `${config.name} varies compressed assets by Accept-Encoding`);
    for (const type of ['text/css', 'text/javascript', 'application/javascript', 'application/json', 'image/svg+xml']) {
      assert.match(source, new RegExp(`gzip_types[\\s\\S]*${escapeRegex(type)}`), `${config.name} gzips ${type}`);
    }
    assert.match(
      source,
      /location\s+=\s+\/index\.html\s*\{[\s\S]*add_header\s+Cache-Control\s+'no-store'/,
      `${config.name} sets no-store on index.html`
    );
    assert.match(
      source,
      /location\s+\/assets\/\s*\{[\s\S]*add_header\s+Cache-Control\s+'public, max-age=31536000, immutable'/,
      `${config.name} sets immutable cache-control on assets`
    );
    assert.match(source, /location\s+\/\s*\{[^}]*try_files\s+\$uri\s+\$uri\/\s+\/index\.html;/, `${config.name} keeps SPA fallback`);
    if (config.requiresHealthz) {
      assert.match(source, /location\s+=\s+\/healthz\s*\{[^}]*return\s+200\s+"ok";/, `${config.name} keeps healthz`);
    }
  }
});

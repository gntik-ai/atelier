// Fallthrough reverse-proxy for the control-plane executor service.
//
// When the executor is enabled, the gateway repoints the whole data-family wildcard
// (/v1/postgres|mongo|events|functions/*) to it. The executor only serves the data-plane +
// DDL slice; every OTHER path under those prefixes (browse/inventory/management) must keep
// working. The executor therefore proxies any request it does not itself serve to the
// configured control-plane upstream (CONTROL_PLANE_UPSTREAM). This is a pure node:http test:
// a stub upstream stands in for the control-plane, no real backend or registry work needed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';

// Dummy registry: the proxied (unmatched) path never touches it; createControlPlaneServer
// only requires it to be truthy.
const registry = { withWorkspaceClient() { throw new Error('registry must not be called on proxied routes'); } };
const silent = { error() {} };

let upstream;
let upstreamCalls;
let upstreamBase;

before(async () => {
  upstreamCalls = [];
  upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      upstreamCalls.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.writeHead(200, {
        'content-type': 'application/json',
        'x-served-by': 'control-plane',
        'x-correlation-id': req.headers['x-correlation-id']
      });
      res.end(JSON.stringify({ servedBy: 'control-plane', path: req.url }));
    });
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  upstreamBase = `http://127.0.0.1:${upstream.address().port}`;
});

after(async () => {
  if (upstream) await new Promise((r) => upstream.close(r));
});

async function withServer(opts, fn) {
  const server = createControlPlaneServer({ registry, logger: silent, ...opts });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base); } finally { await new Promise((r) => server.close(r)); }
}

const idHeaders = { 'x-tenant-id': 'ten-a', 'x-workspace-id': 'ws-a', 'x-auth-subject': 'user-1' };

test('unmatched path under a data prefix is proxied to the control-plane upstream (method, path, query, identity headers)', async () => {
  await withServer({ controlPlaneUpstream: upstreamBase }, async (base) => {
    upstreamCalls.length = 0;
    const res = await fetch(`${base}/v1/postgres/workspaces/ws-a/inventory?foo=bar&page[size]=5`, {
      headers: { ...idHeaders, 'x-api-version': '2026-03-26', 'x-correlation-id': 'corr-proxy-001' }
    });
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.servedBy, 'control-plane');
    assert.equal(res.headers.get('x-served-by'), 'control-plane');
    assert.equal(res.headers.get('x-correlation-id'), 'corr-proxy-001');

    assert.equal(upstreamCalls.length, 1);
    const call = upstreamCalls[0];
    assert.equal(call.method, 'GET');
    assert.equal(call.url, '/v1/postgres/workspaces/ws-a/inventory?foo=bar&page[size]=5');
    assert.equal(call.headers['x-tenant-id'], 'ten-a');
    assert.equal(call.headers['x-workspace-id'], 'ws-a');
    assert.equal(call.headers['x-api-version'], '2026-03-26');
    assert.equal(call.headers['x-correlation-id'], 'corr-proxy-001');
  });
});

test('proxy generates one correlation when absent and returns the same upstream value', async () => {
  await withServer({ controlPlaneUpstream: upstreamBase }, async (base) => {
    upstreamCalls.length = 0;
    const res = await fetch(`${base}/v1/postgres/workspaces/ws-a/inventory`, {
      headers: { ...idHeaders, 'x-api-version': '2026-03-26' }
    });
    assert.equal(res.status, 200);
    const correlationId = res.headers.get('x-correlation-id');
    assert.match(correlationId, /^[A-Za-z0-9._:-]{8,128}$/);
    assert.equal(upstreamCalls[0].headers['x-correlation-id'], correlationId);
  });
});

test('proxy preserves authentication precedence before trace-header rejection', async () => {
  await withServer({ controlPlaneUpstream: upstreamBase }, async (base) => {
    upstreamCalls.length = 0;
    const res = await fetch(`${base}/v1/postgres/workspaces/ws-a/inventory`, {
      headers: { 'x-api-version': 'obsolete', 'x-correlation-id': 'bad correlation value' }
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'GW_UNAUTHENTICATED');
    assert.equal(body.correlationId, res.headers.get('x-correlation-id'));
    assert.equal(upstreamCalls.length, 0);
  });
});

test('a globally unpublished fall-through path remains 404 before authentication or trace validation', async () => {
  await withServer({ controlPlaneUpstream: upstreamBase }, async (base) => {
    upstreamCalls.length = 0;
    const res = await fetch(`${base}/v1/postgres/c03-definitely-not-a-route`, {
      headers: { 'x-api-version': 'obsolete', 'x-correlation-id': 'bad correlation value' }
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.code, 'GW_NO_ROUTE');
    assert.equal(body.correlationId, res.headers.get('x-correlation-id'));
    assert.notEqual(body.correlationId, 'bad correlation value');
    assert.equal(upstreamCalls.length, 0);
  });
});

test('published preflight is anonymous, trace-exempt, and advertises the public CORS contract', async () => {
  await withServer({}, async (base) => {
    upstreamCalls.length = 0;
    const res = await fetch(`${base}/v1/postgres/workspaces/ws-a/inventory`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://console.example.test',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization,x-api-version,x-correlation-id'
      }
    });
    assert.equal(res.status, 204);
    assert.match(res.headers.get('access-control-allow-headers'), /x-api-version/i);
    assert.match(res.headers.get('access-control-allow-headers'), /x-correlation-id/i);
    assert.match(res.headers.get('access-control-expose-headers'), /x-correlation-id/i);
    assert.match(res.headers.get('x-correlation-id'), /^[A-Za-z0-9._:-]{8,128}$/);
    assert.equal(upstreamCalls.length, 0);
  });
});

test('preflight for a globally unpublished path remains 404 without upstream contact', async () => {
  await withServer({ controlPlaneUpstream: upstreamBase }, async (base) => {
    upstreamCalls.length = 0;
    const res = await fetch(`${base}/v1/postgres/c03-definitely-not-a-route`, {
      method: 'OPTIONS',
      headers: { 'access-control-request-method': 'GET' }
    });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).code, 'GW_NO_ROUTE');
    assert.equal(upstreamCalls.length, 0);
  });
});

test('proxy rejects missing, unsupported, ambiguous, and malformed trace headers before forwarding', async (t) => {
  const cases = [
    ['missing version', { ...idHeaders }, 'GW_API_VERSION_REQUIRED'],
    ['unsupported version', { ...idHeaders, 'x-api-version': '2025-01-01' }, 'GW_UNSUPPORTED_API_VERSION'],
    ['combined version', { ...idHeaders, 'x-api-version': '2026-03-26, 2026-03-26' }, 'GW_UNSUPPORTED_API_VERSION'],
    ['malformed correlation', {
      ...idHeaders,
      'x-api-version': '2026-03-26',
      'x-correlation-id': 'bad correlation value'
    }, 'GW_INVALID_CORRELATION_ID']
  ];

  for (const [name, headers, expectedCode] of cases) {
    await t.test(name, async () => {
      await withServer({ controlPlaneUpstream: upstreamBase }, async (base) => {
        upstreamCalls.length = 0;
        const res = await fetch(`${base}/v1/postgres/workspaces/ws-a/inventory`, { headers });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.code, expectedCode);
        assert.match(res.headers.get('x-correlation-id'), /^[A-Za-z0-9._:-]{8,128}$/);
        assert.equal(body.correlationId, res.headers.get('x-correlation-id'));
        assert.notEqual(res.headers.get('x-correlation-id'), 'bad correlation value');
        assert.equal(upstreamCalls.length, 0);
      });
    });
  }
});

test('proxy forwards the request body unchanged for write methods', async () => {
  await withServer({ controlPlaneUpstream: upstreamBase }, async (base) => {
    upstreamCalls.length = 0;
    const payload = JSON.stringify({ filter: { status: 'active' }, changes: { status: 'archived' } });
    const res = await fetch(`${base}/v1/postgres/workspaces/ws-a/data/appdb/schemas/public/tables/notes/bulk/update`, {
      method: 'POST',
      headers: {
        ...idHeaders,
        'content-type': 'application/json',
        'x-api-version': '2026-03-26',
        'x-correlation-id': 'corr-proxy-write-001'
      },
      body: payload,
    });
    assert.equal(res.status, 200);
    assert.equal(upstreamCalls.length, 1);
    assert.equal(upstreamCalls[0].method, 'POST');
    assert.equal(upstreamCalls[0].body, payload);
  });
});

test('a path the executor DOES serve is handled locally, never proxied', async () => {
  await withServer({ controlPlaneUpstream: upstreamBase }, async (base) => {
    upstreamCalls.length = 0;
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'ok');
    assert.equal(upstreamCalls.length, 0); // local route wins over the proxy
  });
});

test('without an upstream configured, an unmatched path returns canonical 404 GW_NO_ROUTE', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(`${base}/v1/postgres/workspaces/ws-a/inventory`, { headers: idHeaders });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).code, 'GW_NO_ROUTE');
  });
});

test('a hostile request-target cannot redirect the proxy off the configured upstream host (SSRF)', async () => {
  // fetch normalizes the request-target, so craft a raw absolute/protocol-relative target
  // (`//169.254.169.254/…`, the cloud metadata IP) over a TCP socket. The proxy must pin the
  // host to the configured upstream and forward only the path → our stub upstream receives it,
  // and nothing ever leaves for 169.254.169.254.
  await withServer({ controlPlaneUpstream: upstreamBase }, async (base) => {
    upstreamCalls.length = 0;
    const { hostname, port } = new URL(base);
    const raw = await new Promise((resolve, reject) => {
      const sock = net.connect(Number(port), hostname, () => {
        sock.write(
          'GET //169.254.169.254/v1/postgres/workspaces/ws-a/inventory HTTP/1.1\r\n' +
          'Host: x\r\nx-tenant-id: ten-a\r\nx-workspace-id: ws-a\r\nx-auth-subject: user-1\r\n' +
          'x-api-version: 2026-03-26\r\nx-correlation-id: corr-proxy-ssrf-001\r\nConnection: close\r\n\r\n',
        );
      });
      let buf = '';
      sock.on('data', (d) => { buf += d; });
      sock.on('end', () => resolve(buf));
      sock.on('error', reject);
    });
    assert.match(raw, /HTTP\/1\.1 200/);
    assert.equal(upstreamCalls.length, 1); // reached OUR upstream, not the metadata host
    assert.equal(upstreamCalls[0].url, '/v1/postgres/workspaces/ws-a/inventory');
  });
});

test('proxy returns 502 when the control-plane upstream is unreachable', async () => {
  // Point at a closed port (the upstream server is listening elsewhere).
  await withServer({ controlPlaneUpstream: 'http://127.0.0.1:1' }, async (base) => {
    const res = await fetch(`${base}/v1/postgres/workspaces/ws-a/inventory`, {
      headers: { ...idHeaders, 'x-api-version': '2026-03-26', 'x-correlation-id': 'corr-proxy-502-001' }
    });
    assert.equal(res.status, 502);
    assert.match(res.headers.get('x-correlation-id'), /^[A-Za-z0-9._:-]{8,128}$/);
    assert.equal((await res.json()).code, 'GW_UPSTREAM_UNAVAILABLE');
  });
});

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { handleMcpMessage } from '../control-plane-executor/src/mcp-official-server.mjs';
import { PUBLIC_API_VERSION, resolveCorrelationId } from '../shared/error-envelope.mjs';

const PORT = Number(process.env.PORT || 8080);
const FALCONE_API_BASE_URL = process.env.FALCONE_API_BASE_URL || 'http://falcone-control-plane:8080';
const RUNTIME_VERSION = process.env.FALCONE_VERSION || '0.3.0';

export function headerList(value) {
  if (!value) return [];
  const raw = Array.isArray(value) ? value.join(',') : String(value);
  return raw.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
}

export function contextFromHeaders(headers = {}) {
  const scopes = new Set([...headerList(headers['x-auth-scopes']), ...headerList(headers['x-falcone-scopes'])]);
  return {
    tenantId: headers['x-tenant-id'] || headers['x-falcone-tenant-id'] || null,
    roles: [...headerList(headers['x-actor-roles']), ...headerList(headers['x-falcone-roles'])],
    grantedScopes: [...scopes],
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(Object.assign(new Error('request body too large'), { statusCode: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error('invalid JSON body'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function writeJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function callFalconeFrom(req, method, path, body) {
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-api-version': PUBLIC_API_VERSION,
    'x-correlation-id': resolveCorrelationId(req.headers['x-correlation-id']),
  };
  for (const name of ['authorization', 'x-tenant-id', 'x-workspace-id']) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(new URL(path, FALCONE_API_BASE_URL), init);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/healthz' || req.url === '/readyz')) {
    return writeJson(res, 200, { status: 'ready', runtime: 'mcp', version: RUNTIME_VERSION });
  }
  if (req.method !== 'POST') {
    return writeJson(res, 405, { error: 'method_not_allowed' });
  }
  try {
    const message = await readJson(req);
    const context = {
      ...contextFromHeaders(req.headers),
      callFalcone: (method, path, body) => callFalconeFrom(req, method, path, body),
    };
    const result = await handleMcpMessage(message, context);
    writeJson(res, 200, result);
  } catch (error) {
    writeJson(res, error.statusCode || 500, { error: error.message || 'mcp runtime error' });
  }
});

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) server.listen(PORT, () => console.log(`mcp-runtime listening on :${PORT}`));

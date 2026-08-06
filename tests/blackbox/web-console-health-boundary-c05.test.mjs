import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const STATIC_SERVER = fileURLToPath(new URL('../../apps/web-console/static-server.mjs', import.meta.url));
const INDEX_MARKER = 'bbx-c05-web-console-shell';
const INDEX_HTML = `<!doctype html><html><body><main id="${INDEX_MARKER}">Falcone</main></body></html>`;

async function startWebConsole(t) {
  const staticRoot = await mkdtemp(path.join(tmpdir(), 'falcone-c05-web-console-'));
  await writeFile(path.join(staticRoot, 'index.html'), INDEX_HTML, 'utf8');

  const child = spawn(process.execPath, [STATIC_SERVER], {
    env: {
      ...process.env,
      WEB_CONSOLE_STATIC_ROOT: staticRoot,
      PORT: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`web-console did not announce an ephemeral port; stdout=${stdout}; stderr=${stderr}`));
    }, 5_000);

    const failOnExit = (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`web-console exited before listening (code=${code}, signal=${signal}); stderr=${stderr}`));
    };
    child.once('exit', failOnExit);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const match = stdout.match(/web-console static server on :(\d+)/);
      if (!match) return;
      clearTimeout(timer);
      child.off('exit', failOnExit);
      resolve(Number(match[1]));
    });
  });

  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
    await rm(staticRoot, { recursive: true, force: true });
  });

  return { origin: `http://127.0.0.1:${port}` };
}

async function get(origin, requestPath) {
  const response = await fetch(`${origin}${requestPath}`, {
    headers: { connection: 'close' },
    redirect: 'manual'
  });
  return { response, text: await response.text() };
}

// bbx-c05-008 | fn-observability-health-runtime | OpenSpec #### Scenario: Anonymous public-edge caller
test('C-05 web-console never exposes control-plane health probes through SPA fallback', async (t) => {
  const { origin } = await startWebConsole(t);

  const internalProbePaths = [
    '/readyz',
    '/livez',
    '/internal/health',
    '/internal/ready',
    '/internal/live',
    '/internal/health/components/control_plane',
    '/internal/ready/components/control_plane',
    '/internal/live/components/control_plane',
    '/internal%2Fhealth',
    '/internal%2Fready%2Fcomponents%2Fcontrol_plane'
  ];

  for (const requestPath of internalProbePaths) {
    const { response, text } = await get(origin, requestPath);
    assert.equal(response.status, 404, `${requestPath} must remain outside the web-console boundary`);
    assert.equal(text.includes(INDEX_MARKER), false, `${requestPath} must not receive the SPA shell`);
    assert.notEqual(text, INDEX_HTML, `${requestPath} must not fall back to index.html`);
  }

  const health = await get(origin, '/healthz');
  assert.equal(health.response.status, 200);
  assert.equal(health.text, 'ok');

  for (const requestPath of ['/', '/workspaces/example/functions']) {
    const { response, text } = await get(origin, requestPath);
    assert.equal(response.status, 200, `${requestPath} must remain available`);
    assert.equal(text, INDEX_HTML);
    assert.ok(text.includes(INDEX_MARKER));
  }
});

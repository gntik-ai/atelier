/**
 * bbx-933-console-01..10 | fn-knative-runtime-status, fn-mcp-hosted-runtime, fn-function-action-mutation, fn-function-runtime-availability-gate
 * OpenSpec scenarios are mapped in the focused Vitest and type-contract files beside this runner.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'

const capabilityDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(capabilityDir, '../../..')

test('bbx-933-console-01..10: managed Knative console public behavior', () => {
  const result = spawnSync('pnpm', [
    '--filter', '@in-falcone/web-console',
    'exec', 'vitest', 'run',
    '--config', resolve(capabilityDir, 'vitest.config.ts'),
    '--typecheck'
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' }
  })

  assert.equal(result.status, 0, [result.stdout, result.stderr].filter(Boolean).join('\n'))
})

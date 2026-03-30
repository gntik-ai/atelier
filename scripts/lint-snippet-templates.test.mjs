import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { spawnSync } from 'node:child_process'

import { realtimeSnippetTemplates } from './realtime-snippet-templates.data.mjs'

const fill = (template) => template
  .replaceAll('{REALTIME_ENDPOINT}', 'wss://rt.example.test')
  .replaceAll('{WORKSPACE_ID}', 'ws_example')
  .replaceAll('{CHANNEL_TYPE}', 'postgresql-changes')

const toParsableJavascript = (code) => code.replace(/^import .*$/gm, '')

test('js templates parse without throwing', () => {
  for (const item of realtimeSnippetTemplates.filter((entry) => entry.language === 'javascript')) {
    assert.doesNotThrow(() => new vm.Script(toParsableJavascript(fill(item.template))), item.id)
  }
})

test('templates do not contain real-looking JWTs or bearer secrets', () => {
  for (const item of realtimeSnippetTemplates) {
    const code = fill(item.template)
    assert.doesNotMatch(code, /eyJ[A-Za-z0-9_\-]{20,}/, item.id)
    assert.doesNotMatch(code, /Bearer [A-Za-z0-9_\-.]{20,}/, item.id)
  }
})

const pythonVersion = spawnSync('python3', ['--version'], { encoding: 'utf8' })

test('python templates pass syntax check when python3 exists', { skip: pythonVersion.status !== 0 }, () => {
  for (const item of realtimeSnippetTemplates.filter((entry) => entry.language === 'python')) {
    const result = spawnSync('python3', ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], { input: fill(item.template), encoding: 'utf8' })
    assert.equal(result.status, 0, `${item.id}: ${result.stderr}`)
  }
})

test('all templates include placeholder tokens', () => {
  for (const item of realtimeSnippetTemplates) {
    assert.match(item.template, /<YOUR_ACCESS_TOKEN>|<YOUR_SERVICE_ACCOUNT_TOKEN>/, item.id)
  }
})

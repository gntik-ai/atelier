import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'

import { realtimeSnippetTemplates } from './realtime-snippet-templates.data.mjs'

const FALLBACKS = {
  '{REALTIME_ENDPOINT}': 'wss://rt.example.test',
  '{WORKSPACE_ID}': 'ws_example',
  '{CHANNEL_TYPE}': 'postgresql-changes'
}

function fill(template) {
  return Object.entries(FALLBACKS).reduce((acc, [token, value]) => acc.replaceAll(token, value), template)
}

function toParsableJavascript(code) {
  return code.replace(/^import .*$/gm, '')
}

function parseMarkdownCodeBlocks(markdown) {
  const matches = markdown.matchAll(/```(javascript|typescript|js|ts|python)\n([\s\S]*?)```/g)
  return Array.from(matches, (match) => ({ language: match[1], code: match[2].trim() }))
}

let failed = false
for (const item of realtimeSnippetTemplates) {
  const code = fill(item.template)
  if (/Bearer [A-Za-z0-9_\-.]{20,}/.test(code) || /eyJ[A-Za-z0-9_\-]{20,}/.test(code)) {
    console.error(`Embedded credential-like token detected in ${item.id}`)
    failed = true
  }

  if (item.language === 'javascript') {
    try {
      new vm.Script(toParsableJavascript(code))
    } catch (error) {
      console.error(`JavaScript syntax error in ${item.id}: ${error.message}`)
      failed = true
    }
  } else if (item.language === 'python') {
    const python = spawnSync('python3', ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], { input: code, encoding: 'utf8' })
    if (python.error && python.error.code === 'ENOENT') {
      console.warn(`WARN python3 not available; skipping Python syntax validation for ${item.id}`)
    } else if (python.status !== 0) {
      console.error(`Python syntax error in ${item.id}: ${python.stderr}`)
      failed = true
    }
  }
}

const guides = [
  'docs/guides/realtime/frontend-quickstart.md',
  'docs/guides/realtime/nodejs-quickstart.md',
  'docs/guides/realtime/python-quickstart.md'
]

for (const guide of guides) {
  const markdown = readFileSync(new URL(`../${guide}`, import.meta.url), 'utf8')
  const blocks = parseMarkdownCodeBlocks(markdown)
  if (blocks.length < 3) {
    console.error(`Expected at least 3 code blocks in ${guide}`)
    failed = true
  }
}

const catalogSource = readFileSync(new URL('../apps/web-console/src/lib/snippets/snippet-catalog.ts', import.meta.url), 'utf8')
for (const item of realtimeSnippetTemplates) {
  if (!catalogSource.includes(item.id)) {
    console.error(`Catalog missing snippet id ${item.id}`)
    failed = true
  }
}

if (failed) process.exit(1)
console.log('Realtime snippet templates validated successfully.')

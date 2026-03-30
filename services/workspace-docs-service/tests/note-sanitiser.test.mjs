import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitise } from '../src/note-sanitiser.mjs'

test('sanitise strips tags and keeps text', () => {
  assert.equal(sanitise('<script>alert(1)</script> hola'), 'alert(1) hola')
  assert.equal(sanitise('<img onerror="x" />texto'), 'texto')
  assert.equal(sanitise('texto limpio'), 'texto limpio')
})

test('sanitise rejects empty content', () => {
  assert.throws(() => sanitise('<div>   </div>'), /Invalid note content/)
})

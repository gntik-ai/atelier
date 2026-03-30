import test from 'node:test'
import assert from 'node:assert/strict'
import { recordAccess } from '../src/doc-audit.mjs'

test('recordAccess emits only when insert happens', async () => {
  const sent = []
  const db = { query: async () => ({ rowCount: 1 }) }
  const kafkaProducer = { send: async (message) => sent.push(message) }
  const inserted = await recordAccess(db, kafkaProducer, 'wrk-1', 'actor-1', 'corr-1', 'ten-1')
  assert.equal(inserted, true)
  assert.equal(sent.length, 1)
})

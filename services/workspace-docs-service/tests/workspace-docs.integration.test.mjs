import test from 'node:test'
import assert from 'node:assert/strict'
import { recordAccess } from '../src/doc-audit.mjs'

test('recordAccess deduplicates by rowCount contract', async () => {
  let rowCount = 1
  const db = { query: async () => ({ rowCount: rowCount-- > 0 ? 1 : 0 }) }
  const sent = []
  const kafkaProducer = { send: async (payload) => sent.push(payload) }
  await recordAccess(db, kafkaProducer, 'wrk-1', 'actor-1', 'corr-1', 'ten-1')
  await recordAccess(db, kafkaProducer, 'wrk-1', 'actor-1', 'corr-1', 'ten-1')
  assert.equal(sent.length, 1)
})

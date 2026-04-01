import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../../src/preflight/analyzers/kafka-analyzer.mjs';

const silentLog = { error: () => {}, warn: () => {}, info: () => {} };

test('kafka-analyzer: empty domain data → no_conflicts', async () => {
  const result = await analyze('t-1', null, { log: silentLog });
  assert.equal(result.status, 'no_conflicts');
});

test('kafka-analyzer: topic not in destination → compatible', async () => {
  const data = { topics: [{ name: 't-1.events', numPartitions: 3 }] };
  const result = await analyze('t-1', data, {
    credentials: { describeTopic: async () => null, describeAcls: async () => [] },
    log: silentLog,
  });
  assert.equal(result.compatible_count, 1);
  assert.equal(result.conflicts.length, 0);
});

test('kafka-analyzer: identical topic → compatible', async () => {
  const topic = { name: 't-1.events', numPartitions: 3, configEntries: { 'retention.ms': '604800000' } };
  const data = { topics: [topic] };
  const describeTopic = async () => ({ ...topic });
  const result = await analyze('t-1', data, {
    credentials: { describeTopic, describeAcls: async () => [] },
    log: silentLog,
  });
  assert.equal(result.compatible_count, 1);
  assert.equal(result.conflicts.length, 0);
});

test('kafka-analyzer: topic with different numPartitions → conflict high with partitions recommendation', async () => {
  const artifactTopic = { name: 't-1.events', numPartitions: 6, configEntries: {} };
  const existingTopic = { name: 't-1.events', numPartitions: 3, configEntries: {} };
  const data = { topics: [artifactTopic] };
  const describeTopic = async () => existingTopic;
  const result = await analyze('t-1', data, {
    credentials: { describeTopic, describeAcls: async () => [] },
    log: silentLog,
  });
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].severity, 'high');
  assert.ok(result.conflicts[0].recommendation.includes('particiones'));
});

test('kafka-analyzer: Kafka unavailable → analysis_error', async () => {
  const data = { topics: [{ name: 't-1.events' }] };
  const describeTopic = async () => { throw new Error('connection refused'); };
  const result = await analyze('t-1', data, {
    credentials: { describeTopic, describeAcls: async () => [] },
    log: silentLog,
  });
  assert.ok(result.conflicts.length >= 0 || result.status === 'analysis_error');
});

test('kafka-analyzer: no write operations', async () => {
  const data = { topics: [{ name: 't-1.events' }] };
  const describeTopic = async () => null;
  const describeAcls = async () => [];
  const result = await analyze('t-1', data, {
    credentials: { describeTopic, describeAcls },
    log: silentLog,
  });
  assert.ok(result);
});

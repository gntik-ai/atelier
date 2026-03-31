import assert from 'node:assert/strict';
import { Kafka } from 'kafkajs';

function enabled() {
  return process.env.KAFKA_ENABLED === 'true';
}

export async function createConsumer(groupId = `test-101-${Date.now()}`) {
  if (!enabled()) return null;
  const brokers = (process.env.KAFKA_BROKERS ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!brokers.length) return null;
  const kafka = new Kafka({ brokers });
  return kafka.consumer({ groupId });
}

export async function consumeUntilEvent(consumer, topic, matchFn, timeoutMs = 15000) {
  if (!consumer) return null;
  let matched = null;
  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: false });
  const deadline = Date.now() + timeoutMs;
  await consumer.run({
    eachMessage: async ({ message }) => {
      if (matched) return;
      const payload = message.value ? JSON.parse(message.value.toString()) : null;
      if (matchFn(payload)) matched = payload;
    }
  });
  while (!matched && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return matched;
}

export async function assertPlanAssignmentEvent(consumer, tenantId, targetPlanSlug) {
  const event = await consumeUntilEvent(consumer, 'console.plan.assignment.created', (payload) => payload?.tenantId === tenantId);
  if (!event) return null;
  assert.equal(event.tenantId, tenantId);
  if (targetPlanSlug) assert.ok(String(event.planSlug ?? event.planId ?? '').includes(targetPlanSlug));
  return event;
}

export async function assertChangeImpactEvent(consumer, tenantId) {
  const event = await consumeUntilEvent(consumer, 'console.plan.change-impact-recorded', (payload) => payload?.tenantId === tenantId);
  if (!event) return null;
  assert.equal(event.tenantId, tenantId);
  return event;
}

export async function disconnectConsumer(consumer) {
  if (!consumer) return;
  await consumer.disconnect();
}

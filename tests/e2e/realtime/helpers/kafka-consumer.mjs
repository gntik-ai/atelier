import { Kafka } from 'kafkajs';
import { poll } from './poller.mjs';

function requireEnv(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export async function createKafkaConsumer({ topic, fromBeginning = false } = {}) {
  const brokers = requireEnv('KAFKA_BROKERS').split(',').map((entry) => entry.trim()).filter(Boolean);
  const clientId = requireEnv('KAFKA_CLIENT_ID', 'realtime-e2e-test');
  const kafka = new Kafka({ clientId, brokers });
  const consumer = kafka.consumer({ groupId: `realtime-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
  const messages = [];

  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning });
  await consumer.run({
    eachMessage: async ({ message }) => {
      const value = message.value?.toString();
      try {
        messages.push(JSON.parse(value));
      } catch {
        messages.push({ raw: value });
      }
    }
  });

  return {
    async waitForMessage(matchFn, opts = {}) {
      let matched;
      await poll(() => {
        matched = messages.find(matchFn);
        if (!matched) {
          throw new Error('matching Kafka message not observed yet');
        }
      }, opts);
      return matched;
    },
    async close() {
      await consumer.disconnect();
    }
  };
}

export default createKafkaConsumer;

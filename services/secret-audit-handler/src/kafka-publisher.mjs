import { Kafka, logLevel } from 'kafkajs';
import { validateAuditEvent } from './event-schema.mjs';

export function createPublisher({ brokers, topic, producer: injectedProducer }) {
  const kafka = injectedProducer ? null : new Kafka({
    brokers,
    logLevel: logLevel.NOTHING,
    retry: { retries: 5, initialRetryTime: 300 }
  });
  const producer = injectedProducer ?? kafka.producer();

  return {
    async connect() {
      await producer.connect();
    },
    async publishAuditEvent(event) {
      validateAuditEvent(event);
      try {
        await producer.send({
          topic,
          messages: [{
            key: event.domain,
            value: JSON.stringify(event),
            headers: {
              eventId: event.eventId,
              domain: event.domain
            }
          }]
        });
      } catch (error) {
        console.error('Failed to publish audit event', error);
      }
    },
    async disconnect() {
      await producer.disconnect();
    }
  };
}

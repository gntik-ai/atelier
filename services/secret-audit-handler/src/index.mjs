import { createLogTailer } from './vault-log-reader.mjs';
import { sanitize } from './sanitizer.mjs';
import { createPublisher } from './kafka-publisher.mjs';

const filePath = process.env.VAULT_AUDIT_LOG_PATH ?? '/vault/audit/vault-audit.log';
const brokers = (process.env.KAFKA_BROKERS ?? '').split(',').filter(Boolean);
const topic = process.env.SECRET_AUDIT_KAFKA_TOPIC ?? 'console.secrets.audit';

if (brokers.length === 0) {
  console.error('KAFKA_BROKERS is required');
  process.exit(1);
}

const publisher = createPublisher({ brokers, topic });

try {
  await publisher.connect();
} catch (error) {
  console.error('Kafka connection failed', error);
  process.exit(1);
}

const shutdown = async () => {
  await publisher.disconnect();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

for await (const entry of createLogTailer(filePath)) {
  const cleaned = sanitize(entry);
  await publisher.publishAuditEvent(cleaned);
}

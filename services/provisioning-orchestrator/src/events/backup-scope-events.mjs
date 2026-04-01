const TOPIC_QUERIED = process.env.BACKUP_SCOPE_KAFKA_TOPIC_QUERIED ?? 'console.backup.scope.queried';

export async function publishScopeQueried(kafkaProducer, { correlationId, actor, tenantId = null, requestedProfile = null, timestamp = new Date().toISOString() } = {}, options = {}) {
  const log = options.log ?? console;

  const event = {
    eventType: 'backup.scope.queried',
    correlationId: correlationId ?? null,
    actor: {
      id: actor?.id ?? null,
      role: actor?.role ?? null
    },
    tenantId: tenantId ?? null,
    requestedProfile: requestedProfile ?? null,
    timestamp
  };

  if (!kafkaProducer?.send) return event;

  try {
    await kafkaProducer.send({
      topic: TOPIC_QUERIED,
      messages: [{ key: correlationId ?? timestamp, value: JSON.stringify(event) }]
    });
  } catch (error) {
    (log.warn ?? log.error ?? console.error)({ msg: 'backup scope audit event publish failed', error: error.message });
  }

  return event;
}

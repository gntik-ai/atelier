const DEFAULT_TOPIC = 'console.plan.limit_updated';

export async function emitLimitUpdated(kafkaProducer, { planId, dimensionKey, previousValue, newValue, actorId, correlationId, timestamp = new Date().toISOString() } = {}, options = {}) {
  const log = options.log ?? console;
  const topic = process.env.PLAN_LIMITS_KAFKA_TOPIC_UPDATED ?? DEFAULT_TOPIC;
  const event = {
    eventType: DEFAULT_TOPIC,
    correlationId: correlationId ?? null,
    actorId: actorId ?? null,
    tenantId: null,
    planId,
    timestamp,
    previousState: { dimensionKey, previousValue: previousValue ?? null },
    newState: { dimensionKey, newValue }
  };

  if (!kafkaProducer?.send) return event;

  try {
    await kafkaProducer.send({
      topic,
      messages: [{ key: planId ?? dimensionKey ?? timestamp, value: JSON.stringify(event) }]
    });
  } catch (error) {
    (log.warn ?? log.error ?? console.error)({ msg: 'plan limit event publish failed', topic, error: error.message });
  }

  return event;
}

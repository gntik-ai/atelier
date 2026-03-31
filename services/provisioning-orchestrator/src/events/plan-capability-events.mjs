const TOPIC_ENABLED = process.env.CAPABILITY_KAFKA_TOPIC_ENABLED ?? 'console.plan.capability.enabled';
const TOPIC_DISABLED = process.env.CAPABILITY_KAFKA_TOPIC_DISABLED ?? 'console.plan.capability.disabled';

export async function emitCapabilityEvents(kafkaProducer, { planId, planSlug, changedItems = [], actorId, correlationId, timestamp = new Date().toISOString() } = {}, options = {}) {
  const log = options.log ?? console;
  const events = changedItems.map((item) => ({
    topic: item.newState ? TOPIC_ENABLED : TOPIC_DISABLED,
    event: {
      eventType: item.newState ? 'console.plan.capability.enabled' : 'console.plan.capability.disabled',
      correlationId: correlationId ?? null,
      actorId: actorId ?? null,
      planId,
      planSlug,
      timestamp,
      payload: {
        capabilityKey: item.capabilityKey,
        displayLabel: item.displayLabel,
        previousState: item.previousState ?? null,
        newState: Boolean(item.newState)
      }
    }
  }));

  if (!kafkaProducer?.send) return events.map((entry) => entry.event);

  try {
    for (const entry of events) {
      await kafkaProducer.send({
        topic: entry.topic,
        messages: [{ key: planId ?? entry.event.payload.capabilityKey ?? timestamp, value: JSON.stringify(entry.event) }]
      });
    }
  } catch (error) {
    (log.warn ?? log.error ?? console.error)({ msg: 'plan capability event publish failed', error: error.message });
  }

  return events.map((entry) => entry.event);
}

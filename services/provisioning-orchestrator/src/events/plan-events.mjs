const TOPIC_MAP = {
  'plan.created': 'PLAN_KAFKA_TOPIC_CREATED',
  'plan.updated': 'PLAN_KAFKA_TOPIC_UPDATED',
  'plan.lifecycle_transitioned': 'PLAN_KAFKA_TOPIC_LIFECYCLE',
  'assignment.created': 'PLAN_KAFKA_TOPIC_ASSIGNMENT_CREATED',
  'assignment.superseded': 'PLAN_KAFKA_TOPIC_ASSIGNMENT_SUPERSEDED'
};

const DEFAULT_TOPICS = {
  PLAN_KAFKA_TOPIC_CREATED: 'console.plan.created',
  PLAN_KAFKA_TOPIC_UPDATED: 'console.plan.updated',
  PLAN_KAFKA_TOPIC_LIFECYCLE: 'console.plan.lifecycle_transitioned',
  PLAN_KAFKA_TOPIC_ASSIGNMENT_CREATED: 'console.plan.assignment.created',
  PLAN_KAFKA_TOPIC_ASSIGNMENT_SUPERSEDED: 'console.plan.assignment.superseded'
};

export async function emitPlanEvent(producer, eventType, payload = {}, options = {}) {
  const log = options.log ?? console;
  const envKey = TOPIC_MAP[eventType];
  const topic = process.env[envKey] ?? DEFAULT_TOPICS[envKey];
  const event = {
    eventType: topic,
    correlationId: payload.correlationId ?? null,
    actorId: payload.actorId ?? null,
    tenantId: payload.tenantId ?? null,
    timestamp: payload.timestamp ?? new Date().toISOString(),
    previousState: payload.previousState ?? null,
    newState: payload.newState ?? null
  };
  if (!producer?.send) return event;
  try {
    await producer.send({ topic, messages: [{ key: payload.tenantId ?? payload.planId ?? payload.actorId ?? event.timestamp, value: JSON.stringify(event) }] });
  } catch (error) {
    (log.warn ?? log.error ?? console.error)({ msg: 'plan event publish failed', eventType, topic, error: error.message });
  }
  return event;
}

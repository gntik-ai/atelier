/**
 * Kafka event publisher for config preflight audit events.
 * Fire-and-forget: Kafka failures are logged but never abort the preflight.
 * @module events/config-preflight-events
 */

import { randomUUID } from 'node:crypto';

export const CONFIG_PREFLIGHT_TOPIC =
  process.env.CONFIG_PREFLIGHT_KAFKA_TOPIC ?? 'console.config.reprovision.preflight';

/**
 * Build the event payload for a preflight audit event.
 * @param {Object} p
 * @returns {Object}
 */
export function buildPreflightAuditEvent(p) {
  return {
    event_id: p.event_id ?? randomUUID(),
    event_type: 'config.preflight.executed',
    emitted_at: new Date().toISOString(),
    correlation_id: p.correlation_id,
    actor: {
      id: p.actor_id,
      type: p.actor_type,
    },
    tenant: {
      target_id: p.tenant_id,
      source_id: p.source_tenant_id,
    },
    artifact: {
      format_version: p.format_version ?? '1.0.0',
      checksum: p.artifact_checksum ?? null,
    },
    analysis: {
      risk_level: p.risk_level ?? null,
      incomplete_analysis: p.incomplete_analysis ?? false,
      needs_confirmation: p.needs_confirmation ?? false,
      domains_analyzed: p.domains_analyzed ?? [],
      domains_skipped: p.domains_skipped ?? [],
      conflict_counts: p.conflict_counts ?? { low: 0, medium: 0, high: 0, critical: 0 },
      total_resources_analyzed: p.total_resources_analyzed ?? 0,
      duration_ms: p.duration_ms ?? null,
    },
  };
}

/**
 * Publish a preflight audit event to Kafka. Fire-and-forget.
 *
 * @param {import('kafkajs').Producer | null} kafkaProducer
 * @param {Object} eventPayload
 * @param {Console} [log]
 * @returns {Promise<{published: boolean}>}
 */
export async function publishPreflightAuditEvent(kafkaProducer, eventPayload, log = console) {
  if (!kafkaProducer?.send) {
    log.warn?.({ event: 'config_preflight_kafka_skip', reason: 'no producer available' });
    return { published: false };
  }

  const event = buildPreflightAuditEvent(eventPayload);

  try {
    await kafkaProducer.send({
      topic: CONFIG_PREFLIGHT_TOPIC,
      messages: [{ key: event.tenant.target_id, value: JSON.stringify(event) }],
    });
    return { published: true };
  } catch (err) {
    log.error?.({
      event: 'config_preflight_kafka_error',
      correlation_id: event.correlation_id,
      error: err.message,
    });
    return { published: false };
  }
}

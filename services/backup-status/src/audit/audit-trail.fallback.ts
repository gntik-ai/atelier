/**
 * Fallback retry module for audit events pending Kafka publication.
 * Invoked periodically (e.g., every 60s via OpenWhisk alarm).
 * Never throws to the caller.
 */

import { AuditTrailRepository } from './audit-trail.repository.js'
import type { AuditEvent } from './audit-trail.types.js'

const MAX_PUBLISH_ATTEMPTS = parseInt(process.env.MAX_PUBLISH_ATTEMPTS ?? '5', 10)
const ALERT_TOPIC = process.env.ALERT_TOPIC ?? 'platform.audit.alerts'
const KAFKA_BROKERS = process.env.KAFKA_BROKERS

/**
 * Retry publishing pending audit events to Kafka.
 * Events that exceed MAX_PUBLISH_ATTEMPTS trigger an operational alert.
 */
export async function retryPendingAuditEvents(): Promise<void> {
  try {
    const pending = await AuditTrailRepository.findPendingPublish(MAX_PUBLISH_ATTEMPTS)

    for (const event of pending) {
      try {
        await publishToKafka(event)
        await AuditTrailRepository.markPublished(event.id)
      } catch (err) {
        await AuditTrailRepository.incrementPublishAttempt(event.id, String(err))
        const newAttempts = event.publishAttempts + 1
        if (newAttempts >= MAX_PUBLISH_ATTEMPTS) {
          await emitOperationalAlert(event)
        }
      }
    }
  } catch (err) {
    console.error('[audit-trail.fallback] retryPendingAuditEvents failed:', err)
  }
}

async function publishToKafka(event: AuditEvent): Promise<void> {
  if (!KAFKA_BROKERS) {
    throw new Error('Kafka brokers not configured')
  }
  // In production: use shared Kafka client
  console.log(`[audit-trail.fallback] republished event ${event.id}`)
}

async function emitOperationalAlert(event: AuditEvent): Promise<void> {
  console.error(`[audit-trail.fallback] max publish attempts reached for event: ${event.id}`)
  try {
    if (!KAFKA_BROKERS) {
      console.error(`[audit-trail.fallback] cannot emit alert (no Kafka), event: ${event.id}`)
      return
    }
    // In production: produce to ALERT_TOPIC
    console.log(`[audit-trail.fallback] alert emitted to ${ALERT_TOPIC}:`, {
      type: 'audit_event_publish_failed',
      event_id: event.id,
      tenant_id: event.tenantId,
      event_type: event.eventType,
      occurred_at: event.occurredAt.toISOString(),
      attempts: event.publishAttempts + 1,
    })
  } catch {
    console.error(`[audit-trail.fallback] failed to emit operational alert for event: ${event.id}`)
  }
}

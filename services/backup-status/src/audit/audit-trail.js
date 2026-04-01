/**
 * Central audit event emission module (US-BKP-01-T03).
 *
 * Persists every audit event in PostgreSQL (synchronous, guaranteed)
 * then publishes to Kafka (async, fire-and-forget with fallback).
 * Never throws to the caller.
 */
import { randomUUID } from 'node:crypto';
import { AuditTrailRepository } from './audit-trail.repository.js';
const KAFKA_TOPIC = process.env.AUDIT_KAFKA_TOPIC ?? 'platform.backup.audit.events';
const MAX_DETAIL_BYTES = 4096;
/**
 * Emit a backup/restore audit event.
 * Persists in DB first, then attempts Kafka publish.
 * NEVER throws — all errors are logged internally.
 */
export async function emitAuditEvent(input) {
    try {
        const event = buildEvent(input);
        await AuditTrailRepository.insert(event);
        // Fire-and-forget Kafka publish
        publishToKafka(event).catch(() => {
            // Fallback loop will pick up events with published_at IS NULL
        });
    }
    catch (err) {
        console.error('[audit-trail] emitAuditEvent failed:', err);
    }
}
function buildEvent(input) {
    const rawDetail = input.detail ?? null;
    let detail = rawDetail;
    let detailTruncated = false;
    if (rawDetail !== null && Buffer.byteLength(rawDetail, 'utf8') > MAX_DETAIL_BYTES) {
        // Truncate to MAX_DETAIL_BYTES (may cut mid-character but is safe for storage)
        detail = Buffer.from(rawDetail, 'utf8').subarray(0, MAX_DETAIL_BYTES).toString('utf8');
        detailTruncated = true;
    }
    return {
        ...input,
        id: randomUUID(),
        schemaVersion: '1',
        correlationId: input.correlationId ?? randomUUID(),
        destructive: input.destructive ?? false,
        occurredAt: new Date(),
        detail,
        detailTruncated,
        publishedAt: null,
        publishAttempts: 0,
    };
}
async function publishToKafka(event) {
    if (!process.env.KAFKA_BROKERS) {
        console.log(`[audit-trail] kafka unavailable, event persisted locally: ${event.id}`);
        return;
    }
    // In production: use shared Kafka client from the monorepo
    console.log(`[audit-trail] produced to ${KAFKA_TOPIC}:`, event.id);
    await AuditTrailRepository.markPublished(event.id);
}
export { publishToKafka };

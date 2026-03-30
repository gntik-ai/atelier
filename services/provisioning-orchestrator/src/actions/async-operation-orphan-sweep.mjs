import {
  atomicTransitionSystem,
  findOrphanCandidates,
  findStaleCancellingCandidates
} from '../repositories/async-operation-repo.mjs';
import { publishCancelledEvent, publishRecoveredEvent } from '../events/async-operation-events.mjs';

function metricAnnotation(name, labels = {}) {
  return { metric: name, labels };
}

function resolveDependencies(params = {}) {
  return {
    db: params.db,
    producer: params.producer,
    repo: params.repo ?? { findOrphanCandidates, findStaleCancellingCandidates, atomicTransitionSystem },
    events: params.events ?? { publishRecoveredEvent, publishCancelledEvent }
  };
}

export async function main(params = {}) {
  const { db, producer, repo, events } = resolveDependencies(params);
  const nowIso = new Date().toISOString();
  const errors = [];
  let orphansRecovered = 0;
  let cancellingForced = 0;

  const orphans = await repo.findOrphanCandidates(db, { nowIso });
  const staleCancelling = await repo.findStaleCancellingCandidates(db, { nowIso });

  for (const candidate of orphans) {
    const reason = candidate.status === 'pending' ? 'stale — never started' : 'orphaned — no progress detected';
    try {
      const { updatedOperation } = await repo.atomicTransitionSystem(db, {
        operation_id: candidate.operation_id,
        tenant_id: candidate.tenant_id,
        new_status: 'failed',
        reason
      });
      await events.publishRecoveredEvent(producer, { ...updatedOperation, previous_status: candidate.status }, reason);
      orphansRecovered += 1;
    } catch (error) {
      errors.push({ operationId: candidate.operation_id, code: error.code ?? 'INTERNAL_ERROR', message: error.message });
    }
  }

  for (const candidate of staleCancelling) {
    const reason = 'cancellation forced — timeout';
    try {
      const { updatedOperation } = await repo.atomicTransitionSystem(db, {
        operation_id: candidate.operation_id,
        tenant_id: candidate.tenant_id,
        new_status: 'cancelled',
        reason,
        cancelled_by: candidate.cancelled_by ?? 'system'
      });
      await events.publishCancelledEvent(producer, { ...updatedOperation, previous_status: candidate.status }, updatedOperation.cancelled_by ?? 'system');
      cancellingForced += 1;
    } catch (error) {
      errors.push({ operationId: candidate.operation_id, code: error.code ?? 'INTERNAL_ERROR', message: error.message });
    }
  }

  return {
    orphansRecovered,
    cancellingForced,
    errors,
    annotations: [metricAnnotation('async_operation_orphan_sweep_total', { recovered: orphansRecovered, forced_cancelled: cancellingForced, errors: errors.length })]
  };
}

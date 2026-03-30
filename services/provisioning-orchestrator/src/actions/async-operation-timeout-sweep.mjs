import { atomicTransitionSystem, findTimedOutCandidates } from '../repositories/async-operation-repo.mjs';
import { publishTimedOutEvent } from '../events/async-operation-events.mjs';

function metricAnnotation(name, labels = {}) {
  return { metric: name, labels };
}

function resolveDependencies(params = {}) {
  return {
    db: params.db,
    producer: params.producer,
    repo: params.repo ?? { findTimedOutCandidates, atomicTransitionSystem },
    events: params.events ?? { publishTimedOutEvent }
  };
}

export async function main(params = {}) {
  const { db, producer, repo, events } = resolveDependencies(params);
  const nowIso = new Date().toISOString();
  const errors = [];
  let swept = 0;

  const candidates = await repo.findTimedOutCandidates(db, { nowIso });

  for (const candidate of candidates) {
    try {
      const { updatedOperation } = await repo.atomicTransitionSystem(db, {
        operation_id: candidate.operation_id,
        tenant_id: candidate.tenant_id,
        new_status: 'timed_out',
        reason: 'timeout exceeded'
      });

      await events.publishTimedOutEvent(producer, { ...updatedOperation, previous_status: candidate.status });
      swept += 1;
    } catch (error) {
      errors.push({ operationId: candidate.operation_id, code: error.code ?? 'INTERNAL_ERROR', message: error.message });
      if (error.code !== 'INVALID_TRANSITION') {
        continue;
      }
    }
  }

  return {
    swept,
    errors,
    annotations: [metricAnnotation('async_operation_timeout_sweep_total', { swept, errors: errors.length })]
  };
}

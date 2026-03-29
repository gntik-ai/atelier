import assert from 'node:assert/strict';
import { __setWorkflowAuditHooksForTesting } from '../../../../apps/control-plane/src/workflows/workflow-audit.mjs';

function sortByOrdinalDescending(records = []) {
  return [...records].sort((a, b) => (b?.detail?.ordinal ?? -1) - (a?.detail?.ordinal ?? -1));
}

function eventTypeOf(record) {
  return record?.event_type ?? record?.action?.action_id ?? null;
}

function tenantIdOf(record) {
  return record?.tenant_id ?? record?.scope?.tenant_id ?? null;
}

export function installAuditCapture() {
  const records = [];

  __setWorkflowAuditHooksForTesting({
    emitAuditRecord(record) {
      records.push(structuredClone(record));
      return { eventId: record?.event_id ?? `capture-${records.length}` };
    }
  });

  return {
    records,
    byCorrelationId(correlationId) {
      return records.filter((record) => record?.correlation_id === correlationId);
    },
    assertComplete(correlationId, expectedEventTypes) {
      const scoped = this.byCorrelationId(correlationId);
      const eventTypes = new Set(scoped.map((record) => eventTypeOf(record)));
      for (const expected of expectedEventTypes) {
        assert.ok(eventTypes.has(expected), `missing audit event ${expected} for correlationId ${correlationId}`);
      }
    },
    assertCompensationOrder(correlationId, expectedStepKeys) {
      const scoped = this.byCorrelationId(correlationId);
      const compensationRecords = sortByOrdinalDescending(
        scoped.filter((record) => eventTypeOf(record) === 'step.compensated')
      );
      assert.deepEqual(
        compensationRecords.map((record) => record?.detail?.stepKey),
        expectedStepKeys,
        `unexpected compensation order for correlationId ${correlationId}`
      );
    },
    assertTenantIsolation(allowedTenantId) {
      const offenders = records.filter((record) => tenantIdOf(record) !== allowedTenantId);
      assert.equal(offenders.length, 0, `found audit records outside tenant ${allowedTenantId}`);
    },
    restore() {
      __setWorkflowAuditHooksForTesting({});
    }
  };
}

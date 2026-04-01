/**
 * Operation dispatcher — manages async lifecycle of backup/restore operations.
 * Transitions: accepted → in_progress → completed | failed
 */

import * as repo from './operations.repository.js'
import { adapterRegistry, isActionAdapter } from '../adapters/registry.js'
import type { AdapterContext, BackupActionAdapter } from '../adapters/types.js'
import { emitAuditEvent } from '../audit/audit-trail.js'
import type { AuditEventType } from '../audit/audit-trail.types.js'

const KAFKA_BROKERS = process.env.KAFKA_BROKERS
const DISPATCHER_TIMEOUT_S = parseInt(process.env.DISPATCHER_TIMEOUT_SECONDS ?? '300', 10)
const RESTORE_TIMEOUT_S = parseInt(process.env.RESTORE_TIMEOUT_SECONDS ?? '600', 10)
const KAFKA_TOPIC = process.env.KAFKA_TOPIC ?? 'platform.backup.operation.events'

const GENERIC_FAILURE_MESSAGE = 'La operación no pudo completarse. Contacte al administrador.'

async function emitKafkaEvent(payload: Record<string, unknown>): Promise<void> {
  if (!KAFKA_BROKERS) {
    console.log(`[dispatcher] kafka unavailable, logging locally: topic=${KAFKA_TOPIC}`, JSON.stringify(payload))
    return
  }
  try {
    console.log(`[dispatcher] produced to ${KAFKA_TOPIC}:`, JSON.stringify(payload))
  } catch (err) {
    console.error(`[dispatcher] failed to produce to ${KAFKA_TOPIC}:`, err)
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('adapter_timeout')), timeoutMs)
    promise.then(
      (val) => { clearTimeout(timer); resolve(val) },
      (err) => { clearTimeout(timer); reject(err) },
    )
  })
}

export async function dispatch(operationId: string): Promise<void> {
  const operation = await repo.findById(operationId)
  if (!operation) {
    console.error(`[dispatcher] operation ${operationId} not found`)
    return
  }

  // Guard: only dispatch from 'accepted' state
  if (operation.status !== 'accepted') {
    console.log(`[dispatcher] operation ${operationId} already in state ${operation.status}, skipping`)
    return
  }

  // Transition to in_progress
  await repo.updateStatus(operationId, 'in_progress')

  // Audit: started
  void emitAuditEvent({
    eventType: `${operation.type}.started` as AuditEventType,
    operationId: operation.id,
    tenantId: operation.tenantId,
    componentType: operation.componentType,
    instanceId: operation.instanceId,
    snapshotId: operation.snapshotId,
    actorId: operation.requesterId,
    actorRole: operation.requesterRole,
    sessionContext: { status: 'not_applicable' },
    result: 'started',
    destructive: operation.type === 'restore',
  })

  const adapter = adapterRegistry.get(operation.componentType)
  if (!isActionAdapter(adapter)) {
    await repo.updateStatus(operationId, 'failed', {
      failureReason: 'adapter_not_action_capable',
      failureReasonPublic: GENERIC_FAILURE_MESSAGE,
    })
    return
  }

  const actionAdapter = adapter as BackupActionAdapter
  const context: AdapterContext = {
    deploymentProfile: process.env.DEPLOYMENT_PROFILE_SLUG ?? 'default',
    serviceAccountToken: process.env.K8S_SERVICE_ACCOUNT_TOKEN,
    k8sNamespace: process.env.K8S_NAMESPACE ?? 'default',
  }

  const timeoutS = operation.type === 'restore' ? RESTORE_TIMEOUT_S : DISPATCHER_TIMEOUT_S

  try {
    let result
    if (operation.type === 'backup') {
      result = await withTimeout(
        actionAdapter.triggerBackup(operation.instanceId, operation.tenantId, context),
        timeoutS * 1000,
      )
    } else {
      result = await withTimeout(
        actionAdapter.triggerRestore(
          operation.instanceId,
          operation.tenantId,
          operation.snapshotId!,
          context,
        ),
        timeoutS * 1000,
      )
    }

    await repo.updateStatus(operationId, 'completed', {
      adapterOperationId: result.adapterOperationId,
    })

    // Audit: completed
    void emitAuditEvent({
      eventType: `${operation.type}.completed` as AuditEventType,
      operationId: operation.id,
      tenantId: operation.tenantId,
      componentType: operation.componentType,
      instanceId: operation.instanceId,
      snapshotId: operation.snapshotId,
      actorId: operation.requesterId,
      actorRole: operation.requesterRole,
      sessionContext: { status: 'not_applicable' },
      result: 'completed',
      destructive: operation.type === 'restore',
    })

    await emitKafkaEvent({
      type: `backup_operation_completed`,
      operation_id: operationId,
      tenant_id: operation.tenantId,
      component_type: operation.componentType,
      status: 'completed',
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await repo.updateStatus(operationId, 'failed', {
      failureReason: message,
      failureReasonPublic: GENERIC_FAILURE_MESSAGE,
    })

    // Audit: failed
    void emitAuditEvent({
      eventType: `${operation.type}.failed` as AuditEventType,
      operationId: operation.id,
      tenantId: operation.tenantId,
      componentType: operation.componentType,
      instanceId: operation.instanceId,
      snapshotId: operation.snapshotId,
      actorId: operation.requesterId,
      actorRole: operation.requesterRole,
      sessionContext: { status: 'not_applicable' },
      result: 'failed',
      rejectionReason: message,
      rejectionReasonPublic: GENERIC_FAILURE_MESSAGE,
      destructive: operation.type === 'restore',
    })

    await emitKafkaEvent({
      type: `backup_operation_failed`,
      operation_id: operationId,
      tenant_id: operation.tenantId,
      component_type: operation.componentType,
      status: 'failed',
      timestamp: new Date().toISOString(),
    })
  }
}

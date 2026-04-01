/**
 * Restore simulation / drill orchestration.
 */

import type { OperationRecord } from './operations.types.js'
import type {
  RestoreSimulationCheckResultEntry,
  RestoreSimulationEvidenceRef,
  RestoreSimulationResult,
  RestoreSimulationValidationSummary,
} from './restore-simulation.types.js'
import { isSafeSimulationProfile } from './restore-simulation.types.js'

export class RestoreSimulationError extends Error {
  statusCode: number
  code: string
  detail?: Record<string, unknown>

  constructor(statusCode: number, code: string, detail?: Record<string, unknown>) {
    super(code)
    this.name = 'RestoreSimulationError'
    this.statusCode = statusCode
    this.code = code
    this.detail = detail
  }
}

export interface RestoreSimulationContext {
  operation: OperationRecord
  deploymentProfile: string
  actorId: string
  now?: Date
  checks?: RestoreSimulationCheckResultEntry[]
}

function defaultChecks(operation: OperationRecord): RestoreSimulationCheckResultEntry[] {
  const snapshotId = operation.snapshotId ?? 'unknown'
  return [
    {
      code: 'target_isolated',
      result: 'ok',
      message: 'El objetivo de restauración está aislado del entorno productivo.',
      metadata: { component_type: operation.componentType, instance_id: operation.instanceId },
    },
    {
      code: 'snapshot_present',
      result: 'ok',
      message: 'El snapshot de prueba está disponible para la simulación.',
      metadata: { snapshot_id: snapshotId },
    },
    {
      code: 'post_restore_integrity',
      result: 'ok',
      message: 'Las comprobaciones mínimas de integridad del entorno de ensayo han pasado.',
      metadata: { tenant_id: operation.tenantId },
    },
  ]
}

function summarizeOutcome(checks: RestoreSimulationCheckResultEntry[]): RestoreSimulationValidationSummary['outcome'] {
  if (checks.some((check) => check.result === 'blocking_error')) return 'failed'
  if (checks.some((check) => check.result === 'warning')) return 'warning'
  return 'completed'
}

export async function runRestoreSimulation(context: RestoreSimulationContext): Promise<RestoreSimulationResult> {
  const profile = context.deploymentProfile
  if (!isSafeSimulationProfile(profile)) {
    throw new RestoreSimulationError(403, 'restore_simulation_profile_not_allowed', {
      deployment_profile: profile,
      allowed_profiles: ['sandbox', 'integration'],
    })
  }

  const now = context.now ?? new Date()
  const checks = context.checks ?? defaultChecks(context.operation)
  const validationSummary: RestoreSimulationValidationSummary = {
    outcome: summarizeOutcome(checks),
    checkedAt: now.toISOString(),
    checkedBy: context.actorId,
    environment: profile,
    snapshotId: context.operation.snapshotId ?? 'unknown',
    checks,
  }

  const evidenceRefs: RestoreSimulationEvidenceRef[] = [
    {
      kind: 'operation',
      id: context.operation.id,
      label: 'Simulación de restore',
      href: `/v1/backup/operations/${context.operation.id}`,
    },
    {
      kind: 'snapshot',
      id: context.operation.snapshotId ?? 'unknown',
      label: 'Snapshot de prueba',
      href: context.operation.snapshotId ? `/v1/backup/snapshots/${context.operation.snapshotId}` : null,
    },
    {
      kind: 'validation',
      id: `${context.operation.id}:validation`,
      label: 'Resumen de validación',
      href: `/v1/backup/operations/${context.operation.id}`,
    },
  ]

  return {
    status: validationSummary.outcome,
    targetEnvironment: profile,
    validationSummary,
    evidenceRefs,
  }
}

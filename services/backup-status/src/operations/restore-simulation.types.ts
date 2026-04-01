/**
 * Types for restore simulation / drill mode.
 */

export type RestoreExecutionMode = 'operative' | 'simulation'

export type RestoreSimulationOutcome = 'completed' | 'warning' | 'failed'

export type RestoreSimulationCheckResult = 'ok' | 'warning' | 'blocking_error'

export interface RestoreSimulationCheckResultEntry {
  code: string
  result: RestoreSimulationCheckResult
  message: string
  metadata?: Record<string, unknown>
}

export interface RestoreSimulationEvidenceRef {
  kind: 'snapshot' | 'validation' | 'audit' | 'operation'
  id: string
  label?: string
  href?: string | null
}

export interface RestoreSimulationValidationSummary {
  outcome: RestoreSimulationOutcome
  checkedAt: string
  checkedBy: string
  environment: string
  snapshotId: string
  checks: RestoreSimulationCheckResultEntry[]
}

export interface RestoreSimulationMetadata {
  execution_mode: 'simulation'
  target_environment: string
  validation_summary?: RestoreSimulationValidationSummary | null
  evidence_refs?: RestoreSimulationEvidenceRef[]
}

export interface RestoreSimulationResult {
  status: RestoreSimulationOutcome
  targetEnvironment: string
  validationSummary: RestoreSimulationValidationSummary
  evidenceRefs: RestoreSimulationEvidenceRef[]
}

export const SAFE_SIMULATION_PROFILES = ['sandbox', 'integration'] as const

export function isSafeSimulationProfile(profile: string): boolean {
  const normalized = profile.toLowerCase()
  return SAFE_SIMULATION_PROFILES.some((allowed) => normalized === allowed || normalized.includes(allowed))
}

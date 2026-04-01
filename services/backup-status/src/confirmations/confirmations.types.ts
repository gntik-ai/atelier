import type { PrecheckResult, PrecheckSummary } from './prechecks/precheck.types.js'
import type { RestoreExecutionMode } from '../operations/restore-simulation.types.js'

export type RiskLevel = 'normal' | 'elevated' | 'critical'

export type ConfirmationStatus =
  | 'pending_confirmation'
  | 'confirmed'
  | 'aborted'
  | 'expired'
  | 'rejected'

export type ConfirmationDecision = 'confirmed' | 'aborted' | 'expired'

export type RestoreScope = 'partial' | 'full'

export type SecondFactorType = 'otp' | 'second_actor'

export interface ConfirmationRequest {
  id: string
  tokenHash: string
  tenantId: string
  componentType: string
  instanceId: string
  snapshotId: string
  requesterId: string
  requesterRole: string
  scope: RestoreScope
  riskLevel: RiskLevel
  status: ConfirmationStatus
  prechecksResult: PrecheckSummary
  warningsShown: string[]
  availableSecondFactors: SecondFactorType[]
  decision?: ConfirmationDecision
  decisionAt?: Date
  secondFactorType?: SecondFactorType
  secondActorId?: string
  operationId?: string
  expiresAt: Date
  createdAt: Date
}

export interface RestoreTarget {
  tenantId: string
  tenantName: string
  componentType: string
  instanceId: string
  snapshotId: string
  snapshotCreatedAt: Date
  snapshotAgeHours: number
}

export interface InitiateRestoreBody {
  tenant_id: string
  component_type: string
  instance_id: string
  snapshot_id: string
  scope?: RestoreScope
  execution_mode?: RestoreExecutionMode
}

export interface InitiateRestoreResponse {
  schemaVersion: '2'
  confirmationToken: string
  confirmationRequestId: string
  expiresAt: Date
  ttlSeconds: number
  riskLevel: RiskLevel
  availableSecondFactors: SecondFactorType[]
  prechecks: PrecheckResult[]
  warnings: string[]
  target: RestoreTarget
}

export interface ConfirmRestoreBody {
  confirmationToken: string
  confirmed: boolean
  tenantNameConfirmation?: string
  acknowledgeWarnings?: boolean
  secondFactorType?: SecondFactorType
  otpCode?: string
  secondActorToken?: string
}

export interface ConfirmRestoreResult {
  schemaVersion: '2'
  operationId?: string
  status: 'accepted' | 'aborted'
  acceptedAt?: Date
  confirmationRequestId?: string
}

export interface ConfirmationStatusResponse {
  schemaVersion: '2'
  id: string
  status: ConfirmationStatus
  riskLevel: RiskLevel
  expiresAt: Date
  createdAt: Date
}

export interface Actor {
  sub: string
  tenantId?: string
  role: string
  scopes: string[]
}

export interface RiskCalculatorConfig {
  criticalMultiWarningThreshold: number
  snapshotAgeWarningHours: number
}

// Backwards-compatible aliases for the existing dirty worktree.
export type RestoreConfirmationRequest = ConfirmationRequest
export type InitiateRestorePayload = InitiateRestoreBody
export type InitiateRestoreTarget = {
  tenant_id: string
  tenant_name: string
  component_type: string
  instance_id: string
  snapshot_id: string
  snapshot_created_at: string
  snapshot_age_hours: number
}
export type ConfirmRestorePayload = {
  confirmation_token: string
  confirmed: boolean
  tenant_name_confirmation?: string
  acknowledge_warnings?: boolean
  second_factor_type?: SecondFactorType
  otp_code?: string
  second_actor_token?: string
}
export type ConfirmRestoreResponse = {
  schema_version: '2'
  operation_id?: string
  status: 'accepted' | 'aborted'
  accepted_at?: string
  confirmation_request_id?: string
}
export type RiskCalculatorInput = {
  scope: RestoreScope
  precheckResults: PrecheckSummary
  snapshotAgeMs: number
  requestedAt: Date
  config: { criticalMultiWarningThreshold: number; snapshotAgeWarningHours: number }
}

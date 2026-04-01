import { createHash, randomBytes } from 'node:crypto'
import { ConfirmationsRepository as ConfirmationsRepositoryClass } from './confirmations.repository.js'
import type { CreateConfirmationRequestDto } from './confirmations.repository.js'
import type {
  Actor,
  ConfirmRestoreBody,
  ConfirmRestoreResult,
  ConfirmationRequest,
  ConfirmationStatusResponse,
  InitiateRestoreBody,
  InitiateRestoreResponse,
  RiskLevel,
  RestoreScope,
  SecondFactorType,
} from './confirmations.types.js'
import type { PrecheckContext, PrecheckResult } from './prechecks/precheck.types.js'
import { runAllPrechecks, type PrecheckDeps } from './prechecks/index.js'
import { calculateRiskLevel, extractWarnings, hasBlockingErrors } from './risk-calculator.js'
import { snapshotExistsPrecheck } from './prechecks/snapshot-exists.precheck.js'
import { verifyOtp } from './second-factor/otp-verifier.js'
import { verifySecondActor } from './second-factor/second-actor-verifier.js'
import * as operationsRepo from '../operations/operations.repository.js'
import * as dispatcher from '../operations/operation-dispatcher.js'
import { emitAuditEvent } from '../audit/audit-trail.js'

export interface ConfirmationsConfig {
  ttlSeconds: number
  precheckTimeoutMs: number
  snapshotAgeWarningHours: number
  criticalMultiWarningThreshold: number
  operationalHoursEnabled: boolean
  operationalHoursStart: string
  operationalHoursEnd: string
  mfaEnabled: boolean
  keycloakOtpVerifyUrl: string
  precheckDeps?: PrecheckDeps
  adapterContext?: unknown
  resolveSnapshotCreatedAt?: (body: InitiateRestoreBody, actor: Actor) => Promise<Date | null> | Date | null
  resolveTenantName?: (tenantId: string) => Promise<string> | string
}

export interface AdapterDispatcher {
  dispatch(operationId: string): Promise<void>
}

export interface AuditTrail {
  emitAuditEvent(input: Parameters<typeof emitAuditEvent>[0]): Promise<void>
}

export class ConfirmationError extends Error {
  statusCode: number
  code: string
  detail?: Record<string, unknown>

  constructor(statusCode: number, code: string, detail?: Record<string, unknown>) {
    super(code)
    this.name = 'ConfirmationError'
    this.statusCode = statusCode
    this.code = code
    this.detail = detail
  }
}

function getDefaultConfig(): ConfirmationsConfig {
  return {
    ttlSeconds: Number(process.env.CONFIRMATION_TTL_SECONDS ?? '300'),
    precheckTimeoutMs: Number(process.env.PRECHECK_TIMEOUT_MS ?? '10000'),
    snapshotAgeWarningHours: Number(process.env.PRECHECK_SNAPSHOT_AGE_WARNING_HOURS ?? '48'),
    criticalMultiWarningThreshold: Number(process.env.CRITICAL_RISK_MULTI_WARNING_THRESHOLD ?? '3'),
    operationalHoursEnabled: process.env.PRECHECK_OPERATIONAL_HOURS_ENABLED !== 'false',
    operationalHoursStart: process.env.PRECHECK_OPERATIONAL_HOURS_START ?? '08:00',
    operationalHoursEnd: process.env.PRECHECK_OPERATIONAL_HOURS_END ?? '20:00',
    mfaEnabled: process.env.MFA_ENABLED !== 'false',
    keycloakOtpVerifyUrl: process.env.KEYCLOAK_OTP_VERIFY_URL ?? '',
  }
}

function generateToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: createHash('sha256').update(token).digest('hex') }
}

function buildRequestFromBody(
  body: InitiateRestoreBody,
  actor: Actor,
  riskLevel: RiskLevel,
  prechecks: PrecheckResult[],
  warnings: string[],
  availableSecondFactors: SecondFactorType[],
  expiresAt: Date,
  tokenHash: string,
): CreateConfirmationRequestDto {
  return {
    tokenHash,
    tenantId: body.tenant_id,
    componentType: body.component_type,
    instanceId: body.instance_id,
    snapshotId: body.snapshot_id,
    requesterId: actor.sub,
    requesterRole: actor.role,
    scope: body.scope ?? 'partial',
    riskLevel,
    status: 'pending_confirmation',
    prechecksResult: prechecks,
    warningsShown: warnings,
    availableSecondFactors,
    expiresAt,
  }
}

function toSnakeCaseInitiate(response: InitiateRestoreResponse) {
  return {
    schema_version: response.schemaVersion,
    confirmation_token: response.confirmationToken,
    confirmation_request_id: response.confirmationRequestId,
    expires_at: response.expiresAt.toISOString(),
    ttl_seconds: response.ttlSeconds,
    risk_level: response.riskLevel,
    available_second_factors: response.availableSecondFactors,
    prechecks: response.prechecks,
    warnings: response.warnings,
    target: {
      tenant_id: response.target.tenantId,
      tenant_name: response.target.tenantName,
      component_type: response.target.componentType,
      instance_id: response.target.instanceId,
      snapshot_id: response.target.snapshotId,
      snapshot_created_at: response.target.snapshotCreatedAt.toISOString(),
      snapshot_age_hours: response.target.snapshotAgeHours,
    },
  }
}

function toSnakeCaseConfirm(response: ConfirmRestoreResult) {
  return {
    schema_version: response.schemaVersion,
    operation_id: response.operationId,
    status: response.status,
    accepted_at: response.acceptedAt?.toISOString(),
    confirmation_request_id: response.confirmationRequestId,
  }
}

export class ConfirmationsService {
  private readonly repo: ConfirmationsRepositoryClass
  private readonly auditTrail: AuditTrail
  private readonly adapterDispatcher: AdapterDispatcher
  private readonly config: ConfirmationsConfig

  constructor(
    repo: ConfirmationsRepositoryClass,
    auditTrail: AuditTrail,
    adapterDispatcher: AdapterDispatcher,
    config: ConfirmationsConfig,
  ) {
    this.repo = repo
    this.auditTrail = auditTrail
    this.adapterDispatcher = adapterDispatcher
    this.config = config
  }

  private async resolveSnapshotCreatedAt(body: InitiateRestoreBody, actor: Actor): Promise<Date> {
    const resolver = this.config.resolveSnapshotCreatedAt
    if (resolver) {
      const resolved = await resolver(body, actor)
      if (resolved) return resolved
    }
    return new Date()
  }

  private async resolveTenantName(tenantId: string): Promise<string> {
    const resolver = this.config.resolveTenantName
    if (resolver) return await resolver(tenantId)
    return tenantId
  }

  async initiate(body: InitiateRestoreBody, actor: Actor): Promise<InitiateRestoreResponse> {
    if (body.execution_mode === 'simulation') {
      throw new ConfirmationError(422, 'simulation_mode_not_supported', {
        execution_mode: body.execution_mode,
      })
    }

    const requestedAt = new Date()
    const snapshotCreatedAt = await this.resolveSnapshotCreatedAt(body, actor)
    const precheckCtx: PrecheckContext = {
      tenantId: body.tenant_id,
      componentType: body.component_type,
      instanceId: body.instance_id,
      snapshotId: body.snapshot_id,
      scope: body.scope ?? 'partial',
      requestedAt,
    }

    const prechecks = await runAllPrechecks(precheckCtx, {
      ...(this.config.precheckDeps ?? { operationsRepo: {
        findActive: operationsRepo.findActive,
      } }),
      adapterContext: this.config.adapterContext,
      snapshotCreatedAt,
      snapshotAgeWarningHours: this.config.snapshotAgeWarningHours,
      operationalHours: {
        enabled: this.config.operationalHoursEnabled,
        start: this.config.operationalHoursStart,
        end: this.config.operationalHoursEnd,
      },
    })

    if (hasBlockingErrors(prechecks)) {
      await this.auditTrail.emitAuditEvent({
        eventType: 'restore.confirmation_pending',
        operationId: null,
        tenantId: body.tenant_id,
        componentType: body.component_type,
        instanceId: body.instance_id,
        snapshotId: body.snapshot_id,
        actorId: actor.sub,
        actorRole: actor.role,
        sessionContext: { status: 'not_applicable' },
        result: 'rejected',
        rejectionReason: 'blocking_precheck_failed',
        rejectionReasonPublic: 'La restauración fue bloqueada por prechecks.',
        destructive: true,
        detail: JSON.stringify({
          blocking_checks: prechecks.filter((p) => p.result === 'blocking_error'),
          prechecks_result: prechecks,
          confirmation_decision: null,
        }),
      })
      throw new ConfirmationError(422, 'blocking_precheck_failed', {
        blocking_checks: prechecks.filter((p) => p.result === 'blocking_error'),
      })
    }

    const snapshotAgeHours = (requestedAt.getTime() - snapshotCreatedAt.getTime()) / 3_600_000
    const riskLevel = calculateRiskLevel(
      body.scope ?? 'partial',
      prechecks,
      snapshotAgeHours,
      false,
      {
        criticalMultiWarningThreshold: this.config.criticalMultiWarningThreshold,
        snapshotAgeWarningHours: this.config.snapshotAgeWarningHours,
      },
    )

    const availableSecondFactors: SecondFactorType[] = riskLevel === 'critical'
      ? [this.config.mfaEnabled ? 'otp' : undefined, 'second_actor'].filter(Boolean) as SecondFactorType[]
      : []

    const { token, tokenHash } = generateToken()
    const expiresAt = new Date(requestedAt.getTime() + this.config.ttlSeconds * 1000)
    const warnings = extractWarnings(prechecks)
    const record = await this.repo.create(buildRequestFromBody(
      body,
      actor,
      riskLevel,
      prechecks,
      warnings,
      availableSecondFactors,
      expiresAt,
      tokenHash,
    ))

    await this.auditTrail.emitAuditEvent({
      eventType: 'restore.confirmation_pending',
      operationId: null,
      tenantId: body.tenant_id,
      componentType: body.component_type,
      instanceId: body.instance_id,
      snapshotId: body.snapshot_id,
      actorId: actor.sub,
      actorRole: actor.role,
      sessionContext: { status: 'not_applicable' },
      result: 'pending',
      destructive: true,
      detail: JSON.stringify({
        confirmation_request_id: record.id,
        prechecks_result: prechecks,
        risk_level: riskLevel,
        warnings_shown: warnings,
        confirmation_decision: null,
        confirmation_timestamp: null,
      }),
    })

    return {
      schemaVersion: '2',
      confirmationToken: token,
      confirmationRequestId: record.id,
      expiresAt,
      ttlSeconds: this.config.ttlSeconds,
      riskLevel,
      availableSecondFactors,
      prechecks,
      warnings,
      target: {
        tenantId: body.tenant_id,
        tenantName: await this.resolveTenantName(body.tenant_id),
        componentType: body.component_type,
        instanceId: body.instance_id,
        snapshotId: body.snapshot_id,
        snapshotCreatedAt,
        snapshotAgeHours,
      },
    }
  }

  async confirm(body: ConfirmRestoreBody, actor: Actor): Promise<ConfirmRestoreResult> {
    const request = await this.repo.findByTokenHash(body.confirmationToken)
    if (!request) {
      throw new ConfirmationError(404, 'confirmation_request_not_found')
    }

    if (request.status !== 'pending_confirmation') {
      throw new ConfirmationError(409, 'confirmation_request_not_pending', { status: request.status })
    }

    const now = new Date()
    if (request.expiresAt.getTime() < now.getTime()) {
      await this.repo.updateDecision(request.id, 'expired', {})
      await this.auditTrail.emitAuditEvent({
        eventType: 'restore.confirmation_expired',
        operationId: null,
        tenantId: request.tenantId,
        componentType: request.componentType,
        instanceId: request.instanceId,
        snapshotId: request.snapshotId,
        actorId: request.requesterId,
        actorRole: request.requesterRole,
        sessionContext: { status: 'not_applicable' },
        result: 'expired',
        destructive: true,
        detail: JSON.stringify({
          confirmation_request_id: request.id,
          confirmation_decision: 'expired',
          confirmation_timestamp: now.toISOString(),
        }),
      })
      throw new ConfirmationError(410, 'confirmation_token_expired', { expired_at: request.expiresAt.toISOString() })
    }

    if (!body.confirmed) {
      await this.repo.updateDecision(request.id, 'aborted', {})
      await this.auditTrail.emitAuditEvent({
        eventType: 'restore.aborted',
        operationId: null,
        tenantId: request.tenantId,
        componentType: request.componentType,
        instanceId: request.instanceId,
        snapshotId: request.snapshotId,
        actorId: actor.sub,
        actorRole: actor.role,
        sessionContext: { status: 'not_applicable' },
        result: 'aborted',
        destructive: true,
        detail: JSON.stringify({
          confirmation_request_id: request.id,
          warnings_shown: request.warningsShown,
          confirmation_decision: 'aborted',
          confirmation_timestamp: now.toISOString(),
        }),
      })
      return {
        schemaVersion: '2',
        status: 'aborted',
        confirmationRequestId: request.id,
      }
    }

    const expectedTenantName = await this.resolveTenantName(request.tenantId)
    if (body.tenantNameConfirmation !== expectedTenantName) {
      throw new ConfirmationError(422, 'tenant_name_confirmation_mismatch')
    }

    if (request.riskLevel !== 'normal' && body.acknowledgeWarnings !== true) {
      throw new ConfirmationError(422, 'warnings_not_acknowledged')
    }

    let secondFactorType: SecondFactorType | undefined
    let secondActorId: string | undefined

    if (request.riskLevel === 'critical') {
      if (!body.secondFactorType) {
        throw new ConfirmationError(422, 'second_factor_verification_failed', { detail: 'second_factor_required' })
      }

      if (body.secondFactorType === 'otp') {
        const otp = await verifyOtp(
          body.otpCode ?? '',
          actor.sub,
          this.config.keycloakOtpVerifyUrl,
          this.config.mfaEnabled,
        )
        if (!otp.valid) {
          throw new ConfirmationError(422, 'second_factor_verification_failed', { detail: otp.error })
        }
        secondFactorType = 'otp'
      } else {
        const secondActor = await verifySecondActor(body.secondActorToken ?? '', actor.sub, request.tenantId)
        if (!secondActor.valid) {
          throw new ConfirmationError(422, 'second_factor_verification_failed', { detail: secondActor.error })
        }
        secondFactorType = 'second_actor'
        secondActorId = secondActor.secondActorId
      }
    }

    const revalidation = await snapshotExistsPrecheck(
      request.tenantId,
      request.componentType,
      request.instanceId,
      request.snapshotId,
      this.config.precheckDeps?.adapterClient ?? null,
      this.config.adapterContext,
    )
    if (revalidation.result === 'blocking_error') {
      throw new ConfirmationError(422, 'snapshot_no_longer_available', { snapshot_id: request.snapshotId })
    }

    const operation = await operationsRepo.create({
      type: 'restore',
      tenantId: request.tenantId,
      componentType: request.componentType,
      instanceId: request.instanceId,
      requesterId: request.requesterId,
      requesterRole: request.requesterRole,
      snapshotId: request.snapshotId,
    })

    await this.repo.updateDecision(request.id, 'confirmed', {
      operationId: operation.id,
      secondFactorType,
      secondActorId,
    })

    void this.adapterDispatcher.dispatch(operation.id).catch((err: unknown) => {
      console.error('[confirmations] dispatch error:', err)
    })

    await this.auditTrail.emitAuditEvent({
      eventType: 'restore.confirmed',
      operationId: operation.id,
      tenantId: request.tenantId,
      componentType: request.componentType,
      instanceId: request.instanceId,
      snapshotId: request.snapshotId,
      actorId: actor.sub,
      actorRole: actor.role,
      sessionContext: { status: 'not_applicable' },
      result: 'confirmed',
      destructive: true,
      detail: JSON.stringify({
        confirmation_request_id: request.id,
        prechecks_result: request.prechecksResult,
        risk_level: request.riskLevel,
        warnings_shown: request.warningsShown,
        confirmation_decision: 'confirmed',
        confirmation_timestamp: now.toISOString(),
        second_factor_method: secondFactorType ?? null,
        second_actor_id: secondActorId ?? null,
      }),
    })

    return {
      schemaVersion: '2',
      operationId: operation.id,
      status: 'accepted',
      acceptedAt: operation.acceptedAt,
    }
  }

  async expireStale(): Promise<number> {
    const now = new Date()
    const expired = await this.repo.findExpiredPending(now)
    for (const request of expired) {
      await this.repo.updateDecision(request.id, 'expired', {})
      await this.auditTrail.emitAuditEvent({
        eventType: 'restore.confirmation_expired',
        operationId: null,
        tenantId: request.tenantId,
        componentType: request.componentType,
        instanceId: request.instanceId,
        snapshotId: request.snapshotId,
        actorId: request.requesterId,
        actorRole: request.requesterRole,
        sessionContext: { status: 'not_applicable' },
        result: 'expired',
        destructive: true,
        detail: JSON.stringify({
          confirmation_request_id: request.id,
          confirmation_decision: 'expired',
          confirmation_timestamp: now.toISOString(),
        }),
      })
    }
    return expired.length
  }

  async getStatus(confirmationRequestId: string, actor: Actor): Promise<ConfirmationStatusResponse> {
    const request = await this.repo.findById(confirmationRequestId)
    if (!request) throw new ConfirmationError(404, 'confirmation_request_not_found')
    if (request.requesterId !== actor.sub && !actor.scopes.includes('backup:restore:global')) {
      throw new ConfirmationError(403, 'access_denied')
    }
    return {
      schemaVersion: '2',
      id: request.id,
      status: request.status,
      riskLevel: request.riskLevel,
      expiresAt: request.expiresAt,
      createdAt: request.createdAt,
    }
  }
}

const defaultService = new ConfirmationsService(
  new ConfirmationsRepositoryClass(),
  { emitAuditEvent },
  dispatcher,
  {
    ...getDefaultConfig(),
  },
)

export async function initiate(
  body: InitiateRestoreBody,
  actor: Actor,
  precheckDeps?: PrecheckDeps,
  snapshotCreatedAt?: Date,
  tenantName?: string,
): Promise<InitiateRestoreResponse> {
  const service = precheckDeps || snapshotCreatedAt || tenantName
    ? new ConfirmationsService(
        new ConfirmationsRepositoryClass(),
        { emitAuditEvent },
        dispatcher,
        { ...getDefaultConfig(), precheckDeps, resolveSnapshotCreatedAt: snapshotCreatedAt ? async () => snapshotCreatedAt : undefined, resolveTenantName: tenantName ? async () => tenantName : undefined },
      )
    : defaultService
  return await service.initiate(body, actor)
}

export async function confirm(
  body: ConfirmRestoreBody,
  actor: Actor,
  precheckDeps?: PrecheckDeps,
): Promise<ConfirmRestoreResult> {
  const service = precheckDeps
    ? new ConfirmationsService(new ConfirmationsRepositoryClass(), { emitAuditEvent }, dispatcher, { ...getDefaultConfig(), precheckDeps })
    : defaultService
  return await service.confirm(body, actor)
}

export async function expireStale(now: Date = new Date()): Promise<number> {
  return await defaultService.expireStale()
}

export async function getStatus(confirmationRequestId: string, actor: Actor): Promise<ConfirmationStatusResponse> {
  return await defaultService.getStatus(confirmationRequestId, actor)
}

export async function abort(confirmationRequestId: string, actor: Actor): Promise<ConfirmRestoreResult> {
  const request = await new ConfirmationsRepositoryClass().findById(confirmationRequestId)
  if (!request) throw new ConfirmationError(404, 'confirmation_request_not_found')
  return await defaultService.confirm({ confirmationToken: request.tokenHash, confirmed: false }, actor)
}

export { toSnakeCaseInitiate, toSnakeCaseConfirm }

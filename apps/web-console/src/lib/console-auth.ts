import { requestJson, type ApiError } from '@/lib/http'

export type ConsoleAuthenticationState = 'active' | 'pending_activation' | 'suspended' | 'credentials_expired'
export type ConsoleSignupMode = 'disabled' | 'approval_required' | 'auto_activate'
export type ConsoleSignupState = 'pending_activation' | 'active' | 'rejected'
export type ConsoleStatusViewId =
  | 'login'
  | 'signup'
  | 'pending_activation'
  | 'account_suspended'
  | 'credentials_expired'
  | 'password_recovery'

export interface ConsoleLoginRequest {
  username: string
  password: string
  rememberMe?: boolean
}

export interface ConsoleSignupRequest {
  username: string
  displayName: string
  primaryEmail: string
  password: string
  requestedEnvironment?: 'dev' | 'sandbox' | 'staging' | 'prod'
  requestedPlanId?: string
}

export interface ConsoleSignupPolicy {
  allowed: boolean
  approvalRequired: boolean
  effectiveMode: ConsoleSignupMode
  globalMode: string
  environmentModes: Record<string, string>
  planModes: Record<string, string>
  reason?: string
}

export interface ConsoleActionLink {
  actionId: string
  label: string
  target: string
}

export interface ConsoleAccountStatusView {
  statusView: ConsoleStatusViewId
  title: string
  message: string
  allowedActions: ConsoleActionLink[]
}

export interface ConsoleSessionPrincipal {
  displayName: string
  primaryEmail: string
  state: ConsoleAuthenticationState
  userId: string
  username: string
  platformRoles: string[]
  tenantIds?: string[]
  workspaceIds?: string[]
}

export interface ConsoleSessionExpirationPolicy {
  maxLifetime?: string
  idleTimeout?: string
  refreshTokenMaxAge?: string
}

export interface ConsoleTokenSet {
  accessToken: string
  expiresAt: string
  expiresIn: number
  refreshExpiresAt: string
  refreshExpiresIn: number
  refreshToken: string
  scope: string
  tokenType: 'Bearer'
}

export interface ConsoleLoginSession {
  sessionId: string
  authenticationState: ConsoleAuthenticationState
  statusView: ConsoleStatusViewId
  issuedAt: string
  lastActivityAt: string
  expiresAt: string
  idleExpiresAt: string
  refreshExpiresAt: string
  sessionPolicy: ConsoleSessionExpirationPolicy
  tokenSet?: ConsoleTokenSet
  nextAction?: string
  principal?: ConsoleSessionPrincipal
}

export interface ConsoleTokenRefreshRequest {
  refreshToken: string
}

export interface ConsoleSignupRegistration {
  registrationId: string
  userId: string
  activationMode: ConsoleSignupMode
  state: ConsoleSignupState
  statusView: ConsoleStatusViewId
  createdAt: string
  message: string
  tenantId?: string
  workspaceId?: string
  provisioning?: {
    state?: string
    summary?: string
  }
}

export interface ConsoleSessionTerminationAccepted {
  sessionId: string
  status: 'accepted'
  acceptedAt: string
}

export interface ConsoleAuthStatusHint {
  statusView: ConsoleStatusViewId
  title: string
  message: string
}

export async function getConsoleSignupPolicy(signal?: AbortSignal): Promise<ConsoleSignupPolicy> {
  return requestJson<ConsoleSignupPolicy>('/v1/auth/signups/policy', { signal })
}

export async function createConsoleLoginSession(
  payload: ConsoleLoginRequest,
  signal?: AbortSignal
): Promise<ConsoleLoginSession> {
  return requestJson<ConsoleLoginSession>('/v1/auth/login-sessions', {
    method: 'POST',
    body: payload as unknown as Record<string, string | boolean>,
    idempotent: true,
    signal
  })
}

export async function refreshConsoleLoginSession(
  sessionId: string,
  refreshToken: string,
  signal?: AbortSignal
): Promise<ConsoleLoginSession> {
  return requestJson<ConsoleLoginSession>(`/v1/auth/login-sessions/${encodeURIComponent(sessionId)}/refresh`, {
    method: 'POST',
    body: {
      refreshToken
    },
    idempotent: true,
    signal
  })
}

export async function terminateConsoleLoginSession(
  sessionId: string,
  accessToken: string,
  signal?: AbortSignal
): Promise<ConsoleSessionTerminationAccepted> {
  return requestJson<ConsoleSessionTerminationAccepted>(`/v1/auth/login-sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    idempotent: true,
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    signal
  })
}

export async function createConsoleSignup(
  payload: ConsoleSignupRequest,
  signal?: AbortSignal
): Promise<ConsoleSignupRegistration> {
  return requestJson<ConsoleSignupRegistration>('/v1/auth/signups', {
    method: 'POST',
    body: payload as unknown as Record<string, string>,
    idempotent: true,
    signal
  })
}

export async function getConsoleAccountStatusView(
  statusViewId: ConsoleStatusViewId,
  signal?: AbortSignal
): Promise<ConsoleAccountStatusView> {
  return requestJson<ConsoleAccountStatusView>(`/v1/auth/status-views/${statusViewId}`, { signal })
}

export function inferStatusViewFromError(error: ApiError): ConsoleAuthStatusHint | null {
  if (error.status !== 409) {
    return null
  }

  const detail = error.detail && typeof error.detail === 'object' ? (error.detail as Record<string, unknown>) : {}
  const rawStatusView =
    (typeof detail.statusView === 'string' && detail.statusView) ||
    (typeof detail.statusViewId === 'string' && detail.statusViewId) ||
    (typeof detail.nextStatusView === 'string' && detail.nextStatusView) ||
    null

  const mappedStatusView = normalizeStatusView(rawStatusView)

  if (mappedStatusView) {
    return getDefaultStatusHint(mappedStatusView, error.message)
  }

  const code = error.code.toLowerCase()
  if (code.includes('PENDING_ACTIVATION'.toLowerCase())) {
    return getDefaultStatusHint('pending_activation', error.message)
  }
  if (code.includes('SUSPENDED')) {
    return getDefaultStatusHint('account_suspended', error.message)
  }
  if (code.includes('CREDENTIALS_EXPIRED')) {
    return getDefaultStatusHint('credentials_expired', error.message)
  }

  return {
    statusView: 'login',
    title: 'No hemos podido completar el acceso',
    message: error.message
  }
}

function normalizeStatusView(value: string | null): ConsoleStatusViewId | null {
  switch (value) {
    case 'pending_activation':
    case 'account_suspended':
    case 'credentials_expired':
    case 'login':
    case 'signup':
    case 'password_recovery':
      return value
    case 'suspended':
      return 'account_suspended'
    default:
      return null
  }
}

function getDefaultStatusHint(statusView: ConsoleStatusViewId, fallbackMessage: string): ConsoleAuthStatusHint {
  switch (statusView) {
    case 'pending_activation':
      return {
        statusView,
        title: 'Tu cuenta está pendiente de activación',
        message: fallbackMessage || 'Todavía no puedes entrar en la consola hasta que se complete la activación.'
      }
    case 'account_suspended':
      return {
        statusView,
        title: 'Tu cuenta está suspendida',
        message: fallbackMessage || 'El acceso a la consola está suspendido temporalmente para esta cuenta.'
      }
    case 'credentials_expired':
      return {
        statusView,
        title: 'Tus credenciales han expirado',
        message: fallbackMessage || 'Necesitas actualizar la contraseña antes de volver a entrar.'
      }
    default:
      return {
        statusView,
        title: 'Estado especial de acceso',
        message: fallbackMessage || 'La cuenta requiere una acción adicional antes de entrar.'
      }
  }
}

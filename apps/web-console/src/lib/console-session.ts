import {
  refreshConsoleLoginSession,
  type ConsoleAuthStatusHint,
  type ConsoleLoginSession
} from '@/lib/console-auth'
import { requestJson, type ApiError, type JsonValue } from '@/lib/http'

const CONSOLE_SHELL_SESSION_STORAGE_KEY = 'in-atelier.console-shell-session'
const CONSOLE_PROTECTED_ROUTE_STORAGE_KEY = 'in-atelier.console-protected-route'
const CONSOLE_AUTH_STATUS_HINT_STORAGE_KEY = 'in-atelier.console-auth-status-hint'
const ACCESS_TOKEN_REFRESH_WINDOW_MS = 60_000

let inFlightSessionRefresh: Promise<ConsoleShellSession | null> | null = null

export interface ConsoleShellSession {
  sessionId: string
  authenticationState: ConsoleLoginSession['authenticationState']
  statusView: ConsoleLoginSession['statusView']
  issuedAt: string
  expiresAt: string
  refreshExpiresAt: string
  principal?: ConsoleLoginSession['principal']
  tokenSet?: ConsoleLoginSession['tokenSet']
}

export interface ConsoleSessionRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: JsonValue
  headers?: HeadersInit
  idempotent?: boolean
  signal?: AbortSignal
}

export function persistConsoleShellSession(session: ConsoleLoginSession): void {
  const snapshot: ConsoleShellSession = {
    sessionId: session.sessionId,
    authenticationState: session.authenticationState,
    statusView: session.statusView,
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
    refreshExpiresAt: session.refreshExpiresAt,
    principal: session.principal,
    tokenSet: session.tokenSet
  }

  writeStorage(CONSOLE_SHELL_SESSION_STORAGE_KEY, snapshot)
}

export function readConsoleShellSession(): ConsoleShellSession | null {
  const parsed = readStorage<Partial<ConsoleShellSession>>(CONSOLE_SHELL_SESSION_STORAGE_KEY)
  if (!parsed || typeof parsed.sessionId !== 'string') {
    return null
  }

  if (!isValidConsoleAuthenticationState(parsed.authenticationState) || !isValidConsoleStatusView(parsed.statusView)) {
    clearConsoleShellSession()
    return null
  }

  if (typeof parsed.issuedAt !== 'string' || typeof parsed.expiresAt !== 'string' || typeof parsed.refreshExpiresAt !== 'string') {
    clearConsoleShellSession()
    return null
  }

  if (parsed.tokenSet && !isValidTokenSet(parsed.tokenSet)) {
    clearConsoleShellSession()
    return null
  }

  return {
    sessionId: parsed.sessionId,
    authenticationState: parsed.authenticationState,
    statusView: parsed.statusView,
    issuedAt: parsed.issuedAt,
    expiresAt: parsed.expiresAt,
    refreshExpiresAt: parsed.refreshExpiresAt,
    principal: parsed.principal,
    tokenSet: parsed.tokenSet
  }
}

export function clearConsoleShellSession(): void {
  removeStorage(CONSOLE_SHELL_SESSION_STORAGE_KEY)
}

export function storeProtectedRouteIntent(path: string): void {
  if (!path.startsWith('/')) {
    return
  }

  writeStorage(CONSOLE_PROTECTED_ROUTE_STORAGE_KEY, path)
}

export function readProtectedRouteIntent(): string | null {
  const value = readStorage<string>(CONSOLE_PROTECTED_ROUTE_STORAGE_KEY)
  return typeof value === 'string' && value.startsWith('/') ? value : null
}

export function consumeProtectedRouteIntent(): string | null {
  const value = readProtectedRouteIntent()
  removeStorage(CONSOLE_PROTECTED_ROUTE_STORAGE_KEY)
  return value
}

export function persistConsoleAuthStatusHint(hint: ConsoleAuthStatusHint): void {
  writeStorage(CONSOLE_AUTH_STATUS_HINT_STORAGE_KEY, hint)
}

export function readConsoleAuthStatusHint(): ConsoleAuthStatusHint | null {
  const hint = readStorage<Partial<ConsoleAuthStatusHint>>(CONSOLE_AUTH_STATUS_HINT_STORAGE_KEY)
  if (!hint || !isValidConsoleStatusView(hint.statusView)) {
    return null
  }

  if (typeof hint.title !== 'string' || typeof hint.message !== 'string') {
    return null
  }

  return {
    statusView: hint.statusView,
    title: hint.title,
    message: hint.message
  }
}

export function consumeConsoleAuthStatusHint(): ConsoleAuthStatusHint | null {
  const hint = readConsoleAuthStatusHint()
  removeStorage(CONSOLE_AUTH_STATUS_HINT_STORAGE_KEY)
  return hint
}

export function hasUsableConsoleSession(session: ConsoleShellSession | null, minimumValidityMs = 0): boolean {
  if (!session || session.authenticationState !== 'active') {
    return false
  }

  const accessToken = session.tokenSet?.accessToken?.trim()
  if (!accessToken) {
    return false
  }

  return !isExpiredAt(resolveAccessTokenExpiry(session), minimumValidityMs)
}

export function canRefreshConsoleSession(session: ConsoleShellSession | null): boolean {
  if (!session || session.authenticationState !== 'active') {
    return false
  }

  const refreshToken = session.tokenSet?.refreshToken?.trim()
  if (!refreshToken) {
    return false
  }

  return !isExpiredAt(session.tokenSet?.refreshExpiresAt || session.refreshExpiresAt)
}

export async function ensureConsoleSession(): Promise<ConsoleShellSession | null> {
  const session = readConsoleShellSession()
  if (!session) {
    return null
  }

  if (hasUsableConsoleSession(session, ACCESS_TOKEN_REFRESH_WINDOW_MS)) {
    return session
  }

  if (!canRefreshConsoleSession(session)) {
    clearConsoleShellSession()
    return null
  }

  return refreshConsoleShellSession(session)
}

export async function refreshConsoleShellSession(session = readConsoleShellSession()): Promise<ConsoleShellSession | null> {
  if (!session || !canRefreshConsoleSession(session)) {
    clearConsoleShellSession()
    return null
  }

  if (inFlightSessionRefresh) {
    return inFlightSessionRefresh
  }

  inFlightSessionRefresh = (async () => {
    try {
      const refreshedSession = await runRefreshWithSingleRetry(session)
      persistConsoleShellSession(refreshedSession)
      return readConsoleShellSession()
    } catch {
      clearConsoleShellSession()
      persistConsoleAuthStatusHint({
        statusView: 'login',
        title: 'Tu sesión ha expirado',
        message: 'Vuelve a autenticarte para continuar en la consola.'
      })
      return null
    } finally {
      inFlightSessionRefresh = null
    }
  })()

  return inFlightSessionRefresh
}

export async function requestConsoleSessionJson<T>(
  url: string,
  options: ConsoleSessionRequestOptions = {}
): Promise<T> {
  const session = await ensureConsoleSession()
  const accessToken = session?.tokenSet?.accessToken?.trim()

  if (!accessToken) {
    throw createConsoleAuthenticationError()
  }

  try {
    return await performAuthenticatedRequest<T>(url, options, accessToken)
  } catch (rawError) {
    const error = rawError as ApiError
    if (error.status !== 401) {
      throw error
    }

    const refreshedSession = await refreshConsoleShellSession()
    const refreshedAccessToken = refreshedSession?.tokenSet?.accessToken?.trim()

    if (!refreshedAccessToken) {
      throw error
    }

    return performAuthenticatedRequest<T>(url, options, refreshedAccessToken)
  }
}

export function getConsolePrincipalLabel(session: ConsoleShellSession | null): string {
  return (
    session?.principal?.displayName?.trim() ||
    session?.principal?.username?.trim() ||
    session?.principal?.primaryEmail?.trim() ||
    'Operador de consola'
  )
}

export function getConsolePrincipalSecondary(session: ConsoleShellSession | null): string {
  return session?.principal?.primaryEmail?.trim() || session?.principal?.username?.trim() || 'Sesión protegida activa'
}

export function getConsolePrincipalInitials(session: ConsoleShellSession | null): string | null {
  const preferredLabel =
    session?.principal?.displayName?.trim() || session?.principal?.username?.trim() || session?.principal?.primaryEmail?.trim() || ''

  if (!preferredLabel) {
    return null
  }

  const parts = preferredLabel
    .replace(/[@._-]+/g, ' ')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length === 0) {
    return null
  }

  const initials = (parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[1]?.[0] ?? '' : parts[0]?.[1] ?? '')
  return initials.trim().slice(0, 2).toUpperCase() || null
}

async function runRefreshWithSingleRetry(session: ConsoleShellSession): Promise<ConsoleLoginSession> {
  try {
    return await refreshConsoleLoginSession(session.sessionId, session.tokenSet!.refreshToken)
  } catch (rawError) {
    const error = rawError as ApiError
    if (!isRetryableRefreshError(error)) {
      throw error
    }

    return refreshConsoleLoginSession(session.sessionId, session.tokenSet!.refreshToken)
  }
}

async function performAuthenticatedRequest<T>(
  url: string,
  options: ConsoleSessionRequestOptions,
  accessToken: string
): Promise<T> {
  const headers = new Headers(options.headers ?? {})
  headers.set('Authorization', `Bearer ${accessToken}`)

  return requestJson<T>(url, {
    method: options.method as never,
    body: options.body,
    headers,
    idempotent: options.idempotent,
    signal: options.signal
  })
}

function createConsoleAuthenticationError(): ApiError {
  return {
    status: 401,
    code: 'HTTP_401',
    message: 'La sesión de consola no está disponible.'
  }
}

function isRetryableRefreshError(error: ApiError): boolean {
  return Boolean(error.retryable) || error.status === 429 || error.status === 504
}

function resolveAccessTokenExpiry(session: ConsoleShellSession): string {
  return session.tokenSet?.expiresAt || session.expiresAt
}

function isExpiredAt(value: string | undefined, minimumValidityMs = 0): boolean {
  if (!value) {
    return true
  }

  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    return true
  }

  return parsed <= Date.now() + minimumValidityMs
}

function isValidTokenSet(value: NonNullable<ConsoleShellSession['tokenSet']>): boolean {
  return (
    typeof value.accessToken === 'string' &&
    typeof value.refreshToken === 'string' &&
    typeof value.expiresAt === 'string' &&
    typeof value.refreshExpiresAt === 'string' &&
    typeof value.expiresIn === 'number' &&
    typeof value.refreshExpiresIn === 'number' &&
    typeof value.scope === 'string' &&
    value.tokenType === 'Bearer'
  )
}

function isValidConsoleAuthenticationState(value: unknown): value is ConsoleShellSession['authenticationState'] {
  return value === 'active' || value === 'pending_activation' || value === 'suspended' || value === 'credentials_expired'
}

function isValidConsoleStatusView(value: unknown): value is ConsoleShellSession['statusView'] {
  return (
    value === 'login' ||
    value === 'signup' ||
    value === 'pending_activation' ||
    value === 'account_suspended' ||
    value === 'credentials_expired' ||
    value === 'password_recovery'
  )
}

function readStorage<T>(key: string): T | null {
  if (typeof window === 'undefined') {
    return null
  }

  const rawValue = window.sessionStorage.getItem(key)
  if (!rawValue) {
    return null
  }

  try {
    return JSON.parse(rawValue) as T
  } catch {
    removeStorage(key)
    return null
  }
}

function writeStorage(key: string, value: unknown): void {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.setItem(key, JSON.stringify(value))
}

function removeStorage(key: string): void {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.removeItem(key)
}

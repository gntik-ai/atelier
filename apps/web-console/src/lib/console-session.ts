import type { ConsoleLoginSession } from '@/lib/console-auth'

const CONSOLE_SHELL_SESSION_STORAGE_KEY = 'in-atelier.console-shell-session'

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

  writeStorage(snapshot)
}

export function readConsoleShellSession(): ConsoleShellSession | null {
  if (typeof window === 'undefined') {
    return null
  }

  const rawValue = window.sessionStorage.getItem(CONSOLE_SHELL_SESSION_STORAGE_KEY)
  if (!rawValue) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<ConsoleShellSession>
    if (!parsed || typeof parsed.sessionId !== 'string') {
      return null
    }

    return {
      sessionId: parsed.sessionId,
      authenticationState: parsed.authenticationState ?? 'active',
      statusView: parsed.statusView ?? 'login',
      issuedAt: parsed.issuedAt ?? '',
      expiresAt: parsed.expiresAt ?? '',
      refreshExpiresAt: parsed.refreshExpiresAt ?? '',
      principal: parsed.principal,
      tokenSet: parsed.tokenSet
    }
  } catch {
    return null
  }
}

export function clearConsoleShellSession(): void {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.removeItem(CONSOLE_SHELL_SESSION_STORAGE_KEY)
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
  return session?.principal?.primaryEmail?.trim() || session?.principal?.username?.trim() || 'Sesión local pendiente de hardening'
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

function writeStorage(snapshot: ConsoleShellSession): void {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.setItem(CONSOLE_SHELL_SESSION_STORAGE_KEY, JSON.stringify(snapshot))
}

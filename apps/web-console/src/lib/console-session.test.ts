import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ConsoleLoginSession } from '@/lib/console-auth'

import {
  consumeConsoleAuthStatusHint,
  persistConsoleShellSession,
  readConsoleShellSession,
  refreshConsoleShellSession,
  requestConsoleSessionJson
} from './console-session'

const fetchMock = vi.fn<typeof fetch>()

const baseSession: ConsoleLoginSession = {
  sessionId: 'ses_test123',
  authenticationState: 'active',
  statusView: 'login',
  issuedAt: '2026-03-28T18:00:00.000Z',
  lastActivityAt: '2026-03-28T18:00:00.000Z',
  expiresAt: '2026-03-28T20:00:00.000Z',
  idleExpiresAt: '2026-03-28T19:00:00.000Z',
  refreshExpiresAt: '2026-03-29T18:00:00.000Z',
  sessionPolicy: {
    maxLifetime: '8h',
    idleTimeout: '1h',
    refreshTokenMaxAge: '24h'
  },
  tokenSet: {
    accessToken: 'access-token-1234567890',
    refreshToken: 'refresh-token-1234567890',
    tokenType: 'Bearer',
    expiresIn: 3600,
    refreshExpiresIn: 7200,
    scope: 'openid profile email',
    expiresAt: '2026-03-28T20:00:00.000Z',
    refreshExpiresAt: '2026-03-29T18:00:00.000Z'
  },
  principal: {
    userId: 'usr_abc123',
    username: 'operaciones',
    displayName: 'Operaciones',
    primaryEmail: 'ops@example.com',
    state: 'active',
    platformRoles: ['platform_operator']
  }
}

describe('console-session', () => {
  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    window.sessionStorage.clear()
  })

  it('trata un snapshot inválido como sesión nula', () => {
    window.sessionStorage.setItem('in-atelier.console-shell-session', JSON.stringify({ nope: true }))

    expect(readConsoleShellSession()).toBeNull()
  })

  it('refresca la sesión y persiste el nuevo token set', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-28T19:59:30.000Z'))
    persistConsoleShellSession(baseSession)

    fetchMock.mockResolvedValueOnce(
      createJsonResponse(200, {
        ...baseSession,
        expiresAt: '2026-03-28T21:00:00.000Z',
        refreshExpiresAt: '2026-03-29T19:00:00.000Z',
        tokenSet: {
          ...baseSession.tokenSet,
          accessToken: 'access-token-refreshed-1234567890',
          expiresAt: '2026-03-28T21:00:00.000Z',
          refreshExpiresAt: '2026-03-29T19:00:00.000Z'
        }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const refreshed = await refreshConsoleShellSession()

    expect(refreshed?.tokenSet?.accessToken).toBe('access-token-refreshed-1234567890')
    expect(readConsoleShellSession()?.tokenSet?.accessToken).toBe('access-token-refreshed-1234567890')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/auth/login-sessions/ses_test123/refresh')
  })

  it('serializa refresh concurrentes en una sola llamada real', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-28T19:59:30.000Z'))
    persistConsoleShellSession(baseSession)

    let resolveRefresh!: (value: Response) => void
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve
    })

    fetchMock.mockReturnValueOnce(refreshResponse)
    vi.stubGlobal('fetch', fetchMock)

    const pendingA = refreshConsoleShellSession()
    const pendingB = refreshConsoleShellSession()

    resolveRefresh(
      createJsonResponse(200, {
        ...baseSession,
        tokenSet: {
          ...baseSession.tokenSet,
          accessToken: 'access-token-concurrent-1234567890'
        }
      })
    )

    const [resultA, resultB] = await Promise.all([pendingA, pendingB])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(resultA?.tokenSet?.accessToken).toBe('access-token-concurrent-1234567890')
    expect(resultB?.tokenSet?.accessToken).toBe('access-token-concurrent-1234567890')
  })

  it('adjunta el bearer a las requests autenticadas', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-28T19:00:00.000Z'))
    persistConsoleShellSession(baseSession)

    fetchMock.mockResolvedValueOnce(createJsonResponse(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(requestConsoleSessionJson('/v1/private/resource')).resolves.toEqual({ ok: true })

    const [, requestInit] = fetchMock.mock.calls[0] ?? []
    const headers = new Headers(requestInit?.headers)
    expect(headers.get('Authorization')).toBe('Bearer access-token-1234567890')
  })

  it('reintenta una request tras 401 con refresh único', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-28T19:00:00.000Z'))
    persistConsoleShellSession(baseSession)

    fetchMock
      .mockResolvedValueOnce(createJsonResponse(401, { status: 401, code: 'HTTP_401', message: 'Unauthorized' }))
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          ...baseSession,
          tokenSet: {
            ...baseSession.tokenSet,
            accessToken: 'access-token-after-401-1234567890'
          }
        })
      )
      .mockResolvedValueOnce(createJsonResponse(200, { ok: true, recovered: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(requestConsoleSessionJson('/v1/private/resource')).resolves.toEqual({ ok: true, recovered: true })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    const [, firstRequestInit] = fetchMock.mock.calls[0] ?? []
    const [, retriedRequestInit] = fetchMock.mock.calls[2] ?? []
    expect(new Headers(firstRequestInit?.headers).get('Authorization')).toBe('Bearer access-token-1234567890')
    expect(new Headers(retriedRequestInit?.headers).get('Authorization')).toBe('Bearer access-token-after-401-1234567890')
  })

  it('limpia la sesión y persiste el hint auth cuando el refresh falla definitivamente', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-28T19:59:30.000Z'))
    persistConsoleShellSession(baseSession)

    fetchMock.mockResolvedValueOnce(
      createJsonResponse(403, {
        status: 403,
        code: 'GW_AUTH_REFRESH_FORBIDDEN',
        message: 'Refresh token no longer valid',
        detail: {},
        requestId: 'req_12345678',
        correlationId: 'corr_12345678',
        timestamp: '2026-03-28T19:59:30.000Z',
        resource: {}
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(refreshConsoleShellSession()).resolves.toBeNull()

    expect(readConsoleShellSession()).toBeNull()
    expect(consumeConsoleAuthStatusHint()).toEqual({
      statusView: 'login',
      title: 'Tu sesión ha expirado',
      message: 'Vuelve a autenticarte para continuar en la consola.'
    })
  })
})

function createJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  })
}

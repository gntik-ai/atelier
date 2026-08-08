/**
 * bbx-933-console-01 | fn-knative-runtime-status
 * OpenSpec: #### Scenario: Read-only status does not grant mutation
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConsoleLoginSession } from '../../../apps/web-console/src/lib/console-auth'
import { clearConsoleShellSession, persistConsoleShellSession } from '../../../apps/web-console/src/lib/console-session'
import { getKnativeRuntimeStatus } from '../../../apps/web-console/src/services/knativeRuntimeApi'

const activeSession: ConsoleLoginSession = {
  sessionId: 'console-session-933',
  authenticationState: 'active',
  statusView: 'active',
  issuedAt: '2026-08-07T09:00:00.000Z',
  lastActivityAt: '2026-08-07T09:00:00.000Z',
  expiresAt: '2099-08-07T10:00:00.000Z',
  idleExpiresAt: '2099-08-07T10:00:00.000Z',
  refreshExpiresAt: '2099-08-08T09:00:00.000Z',
  sessionPolicy: {},
  principal: {
    displayName: 'Runtime auditor',
    primaryEmail: 'auditor@example.test',
    state: 'active',
    userId: 'usr-runtime-auditor',
    username: 'runtime-auditor',
    platformRoles: ['platform_auditor']
  },
  tokenSet: {
    accessToken: 'console-access-token-933',
    expiresAt: '2099-08-07T10:00:00.000Z',
    expiresIn: 3600,
    refreshExpiresAt: '2099-08-08T09:00:00.000Z',
    refreshExpiresIn: 90_000,
    refreshToken: 'console-refresh-token-933',
    scope: 'openid profile',
    tokenType: 'Bearer'
  }
}

describe('issue #933 protected runtime status transport', () => {
  beforeEach(() => {
    clearConsoleShellSession()
    vi.restoreAllMocks()
  })

  it('bbx-933-console-01 sends the protected status request through the active console bearer session', async () => {
    persistConsoleShellSession(activeSession)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      mode: 'managed',
      owner: 'falcone',
      version: '1.22.1',
      compatibility: 'compatible',
      state: 'ready',
      stage: 'ready',
      reason: 'READY',
      lastTransitionAt: '2026-08-07T09:05:00.000Z'
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    await getKnativeRuntimeStatus()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/v1/platform/runtime/knative')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer console-access-token-933')
  })
})

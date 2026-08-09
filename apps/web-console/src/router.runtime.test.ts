import { describe, expect, it } from 'vitest'
import { isPlatformObserverRole } from './router'

describe('platform runtime observer guard', () => {
  it.each(['superadmin', 'platform_admin', 'platform_operator', 'platform_auditor'])('allows %s', (role) => expect(isPlatformObserverRole(role)).toBe(true))
  it.each(['platform_team', 'tenant_admin', 'workspace_member', ''])('denies %s', (role) => expect(isPlatformObserverRole(role)).toBe(false))
})

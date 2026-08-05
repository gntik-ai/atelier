import { describe, expect, it } from 'vitest'

import { canAccessPrivilegeDomainAudit, sessionCanAccessPrivilegeDomainAudit } from './privilege-domain-audit-access'
import type { ConsoleShellSession } from './console-session'

describe('canAccessPrivilegeDomainAudit (C-14 exact-role predicate)', () => {
  it('allows a role list containing platform_admin', () => {
    expect(canAccessPrivilegeDomainAudit(['platform_admin'])).toBe(true)
  })

  it('allows a role list containing tenant_owner', () => {
    expect(canAccessPrivilegeDomainAudit(['tenant_owner'])).toBe(true)
  })

  it('allows a principal carrying both allowed tokens', () => {
    expect(canAccessPrivilegeDomainAudit(['platform_admin', 'tenant_owner'])).toBe(true)
  })

  it('allows the allowed token even alongside other, non-allowed roles', () => {
    expect(canAccessPrivilegeDomainAudit(['tenant_owner', 'workspace_viewer'])).toBe(true)
  })

  // The #1 risk is silent role broadening. superadmin in particular is treated broadly by other
  // console helpers, but this predicate must NOT admit it.
  it.each([
    'superadmin',
    'platform_auditor',
    'platform_operator',
    'tenant_admin',
    'tenant_developer',
    'tenant_viewer',
    'workspace_owner',
    'workspace_admin',
    'workspace_auditor'
  ])('denies a role list containing only %s', (role) => {
    expect(canAccessPrivilegeDomainAudit([role])).toBe(false)
  })

  it('denies an empty, undefined, or null role list', () => {
    expect(canAccessPrivilegeDomainAudit([])).toBe(false)
    expect(canAccessPrivilegeDomainAudit(undefined)).toBe(false)
    expect(canAccessPrivilegeDomainAudit(null)).toBe(false)
  })

  it('does not treat superadmin + platform_auditor together as authorized', () => {
    expect(canAccessPrivilegeDomainAudit(['superadmin', 'platform_auditor'])).toBe(false)
  })
})

describe('sessionCanAccessPrivilegeDomainAudit', () => {
  const sessionWith = (platformRoles: string[]): ConsoleShellSession =>
    ({ principal: { platformRoles } } as unknown as ConsoleShellSession)

  it('reads platformRoles from the session principal', () => {
    expect(sessionCanAccessPrivilegeDomainAudit(sessionWith(['platform_admin']))).toBe(true)
    expect(sessionCanAccessPrivilegeDomainAudit(sessionWith(['superadmin']))).toBe(false)
  })

  it('denies a null session or a principal without roles', () => {
    expect(sessionCanAccessPrivilegeDomainAudit(null)).toBe(false)
    expect(sessionCanAccessPrivilegeDomainAudit({} as ConsoleShellSession)).toBe(false)
  })
})

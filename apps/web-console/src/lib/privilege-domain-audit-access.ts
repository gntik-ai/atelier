// C-14: the single, shared, EXACT role predicate for the privilege-domain denial audit surface.
//
// The complete condition is that the trusted session role list contains `platform_admin` OR
// `tenant_owner` — and nothing else. It deliberately does NOT include or derive access from
// `superadmin`, `platform_auditor`, `tenant_admin`, any workspace role, a generic administration
// flag, platform-inventory access, write permission, or a plan capability. Several other console
// helpers treat `superadmin` as a broad platform administrator; this one must not, because the
// served action (privilege-domain-audit-query.mjs) authorizes only these two exact tokens.
//
// Both the route guard and the navigation item consume this one predicate so neither can drift from
// the backend authorization boundary: a principal for whom this returns false sees no nav entry,
// cannot mount the audit page through direct navigation, and therefore issues no background
// denial-history request.
import type { ConsoleShellSession } from '@/lib/console-session'

export function canAccessPrivilegeDomainAudit(roles: readonly string[] | null | undefined): boolean {
  const list = Array.isArray(roles) ? roles : []
  return list.includes('platform_admin') || list.includes('tenant_owner')
}

export function sessionCanAccessPrivilegeDomainAudit(session: ConsoleShellSession | null): boolean {
  return canAccessPrivilegeDomainAudit(session?.principal?.platformRoles)
}

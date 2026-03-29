import { describe, expect, it } from 'vitest'

import { generateSnippets } from './snippet-generator'
import type { SnippetContext } from './snippet-types'

const baseContext: SnippetContext = {
  tenantId: 'ten_alpha',
  tenantSlug: 'tenant-alpha',
  workspaceId: 'wrk_alpha',
  workspaceSlug: 'workspace-alpha',
  resourceName: 'orders',
  resourceHost: 'db.example.test',
  resourcePort: 5432,
  resourceExtraA: 'public',
  resourceExtraB: 'https://api.example.test/invoke',
  resourceState: 'active',
  externalAccessEnabled: true
}

describe('generateSnippets', () => {
  it('substituye valores reales del contexto', () => {
    const snippets = generateSnippets('postgres-database', baseContext)

    expect(snippets[0]?.code).toContain('db.example.test')
    expect(snippets[0]?.code).toContain('/orders')
    expect(snippets[1]?.code).toContain('port: 5432')
  })

  it('usa placeholders cuando faltan endpoints', () => {
    const snippets = generateSnippets('storage-bucket', {
      ...baseContext,
      resourceHost: null,
      resourcePort: null,
      resourceExtraB: null
    })

    expect(snippets[0]?.code).toContain('<RESOURCE_HOST>')
    expect(snippets.some((snippet) => snippet.notes.some((note) => /placeholders descriptivos/i.test(note)))).toBe(true)
  })

  it('preserva placeholders de secretos y no inyecta credenciales reales', () => {
    const snippets = generateSnippets('iam-client', {
      ...baseContext,
      resourceName: 'atelier-console',
      resourceExtraB: 'https://sso.example.test/realms/tenant/protocol/openid-connect/token'
    })

    expect(snippets[0]?.code).toContain('<CLIENT_SECRET>')
    expect(snippets[0]?.code).not.toContain('super-secret')
  })

  it('devuelve [] para tipos no soportados', () => {
    expect(generateSnippets('unsupported-type' as never, baseContext)).toEqual([])
  })

  it('es determinista para la misma entrada', () => {
    expect(generateSnippets('mongo-collection', baseContext)).toEqual(generateSnippets('mongo-collection', baseContext))
  })

  it('añade advertencias por acceso externo deshabilitado y estados transitorios', () => {
    const snippets = generateSnippets('serverless-function', {
      ...baseContext,
      externalAccessEnabled: false,
      resourceState: 'degraded'
    })

    expect(snippets[0]?.notes.join(' ')).toMatch(/acceso externo/i)
    expect(snippets[0]?.notes.join(' ')).toMatch(/degraded/i)
  })
})

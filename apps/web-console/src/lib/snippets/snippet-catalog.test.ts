import { describe, expect, it } from 'vitest'

import { SNIPPET_CATALOG } from './snippet-catalog'

describe('SNIPPET_CATALOG', () => {
  it('cubre los cinco tipos de recurso soportados', () => {
    expect(Object.keys(SNIPPET_CATALOG)).toEqual([
      'postgres-database',
      'mongo-collection',
      'storage-bucket',
      'serverless-function',
      'iam-client'
    ])
  })

  it('no contiene secretos reales en claro', () => {
    const serialized = JSON.stringify(SNIPPET_CATALOG)

    expect(serialized).not.toMatch(/super-secret|password=real|secret=real|AKIA[0-9A-Z]{16}/i)
    expect(serialized).toMatch(/<CLIENT_SECRET>|<AWS_SECRET_ACCESS_KEY>|<API_TOKEN>|\{PASSWORD\}/)
  })

  it('todos los templates tienen referencia de placeholder o null explícito', () => {
    for (const templates of Object.values(SNIPPET_CATALOG)) {
      for (const template of templates) {
        expect(template).toHaveProperty('secretPlaceholderRef')
      }
    }
  })
})

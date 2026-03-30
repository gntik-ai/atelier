import { describe, expect, it } from 'vitest'

import { SNIPPET_CATALOG } from './snippet-catalog'

describe('SNIPPET_CATALOG', () => {
  it('cubre los seis tipos de recurso soportados', () => {
    expect(Object.keys(SNIPPET_CATALOG)).toEqual([
      'postgres-database',
      'mongo-collection',
      'storage-bucket',
      'serverless-function',
      'realtime-subscription',
      'iam-client'
    ])
  })

  it('no contiene secretos reales en claro', () => {
    const serialized = JSON.stringify(SNIPPET_CATALOG)

    expect(serialized).not.toMatch(/super-secret|password=real|secret=real|AKIA[0-9A-Z]{16}/i)
    expect(serialized).not.toMatch(/Bearer [A-Za-z0-9_\-.]{20,}/)
    expect(serialized).toMatch(/<CLIENT_SECRET>|<AWS_SECRET_ACCESS_KEY>|<API_TOKEN>|\{PASSWORD\}|<YOUR_ACCESS_TOKEN>|<YOUR_SERVICE_ACCOUNT_TOKEN>/)
  })

  it('todos los templates tienen referencia de placeholder o null explícito', () => {
    for (const templates of Object.values(SNIPPET_CATALOG)) {
      for (const template of templates) {
        expect(template).toHaveProperty('secretPlaceholderRef')
      }
    }
  })

  it('define nueve snippets realtime completos y seguros', () => {
    const realtime = SNIPPET_CATALOG['realtime-subscription']

    expect(realtime).toHaveLength(9)
    expect(realtime.map((entry) => entry.id)).toEqual(expect.arrayContaining([
      'realtime-js-browser-basic',
      'realtime-nodejs-backend-basic',
      'realtime-python-backend-basic',
      'realtime-js-browser-filter',
      'realtime-nodejs-backend-filter',
      'realtime-python-backend-filter',
      'realtime-js-browser-reconnect',
      'realtime-nodejs-backend-reconnect',
      'realtime-python-backend-reconnect'
    ]))

    for (const entry of realtime) {
      expect(entry.id).toBeTruthy()
      expect(entry.label).toBeTruthy()
      expect(entry.codeTemplate).toBeTruthy()
      expect(entry.secretTokens).toBeTruthy()
      expect(entry.secretPlaceholderRef).toBeTruthy()
      expect(entry.codeTemplate).not.toMatch(/Bearer [A-Za-z0-9_\-.]{20,}/)
      expect(entry.codeTemplate).toMatch(/<YOUR_ACCESS_TOKEN>|<YOUR_SERVICE_ACCOUNT_TOKEN>/)
    }

    expect(realtime.filter((entry) => entry.id.includes('filter')).every((entry) => /operation|entity/.test(entry.codeTemplate))).toBe(true)
    expect(realtime.filter((entry) => entry.id.includes('reconnect')).every((entry) => /2 \*\* attempt|2\*\*attempt/.test(entry.codeTemplate))).toBe(true)
  })
})

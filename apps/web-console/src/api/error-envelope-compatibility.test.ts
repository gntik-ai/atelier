import { afterEach, describe, expect, it, vi } from 'vitest'

import { getExportableDomains } from './configExportApi'
import { runPreflightCheck } from './configPreflightApi'
import { generateIdentifierMap } from './configReprovisionApi'
import { getFormatVersions } from './configSchemaApi'
import { getOperation } from '../services/backupOperationsApi'

const canonicalError = {
  status: 403,
  code: 'GW_FORBIDDEN',
  message: 'Request forbidden',
  detail: { reason: 'FORBIDDEN' },
  requestId: 'request-console-001',
  correlationId: 'correlation-console-001',
  timestamp: '2026-08-05T00:00:00.000Z',
  resource: { path: '/v1/test' },
}

function rejectWithCanonicalEnvelope() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(canonicalError), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  })))
}

afterEach(() => vi.unstubAllGlobals())

describe('custom API clients consume the canonical error envelope', () => {
  const cases: Array<[string, () => Promise<unknown>]> = [
    ['config export', () => getExportableDomains('tenant-a')],
    ['config preflight', () => runPreflightCheck('tenant-a', { artifact: {} })],
    ['config reprovision', () => generateIdentifierMap('tenant-a', {})],
    ['config schema', () => getFormatVersions()],
    ['backup operations', () => getOperation('operation-a', 'token-a')],
  ]

  for (const [name, invoke] of cases) {
    it(`${name} retains the canonical message and code`, async () => {
      rejectWithCanonicalEnvelope()
      await expect(invoke()).rejects.toMatchObject({
        statusCode: 403,
        code: 'GW_FORBIDDEN',
        message: 'Request forbidden',
      })
    })
  }
})

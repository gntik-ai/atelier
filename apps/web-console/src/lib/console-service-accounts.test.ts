import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createServiceAccount,
  issueServiceAccountCredential,
  normalizeServiceAccount,
  revokeServiceAccountCredential,
  rotateServiceAccountCredential,
  useConsoleServiceAccounts
} from './console-service-accounts'

const mockRequestConsoleSessionJson = vi.fn()
vi.mock('@/lib/console-session', () => ({ requestConsoleSessionJson: (...args: unknown[]) => mockRequestConsoleSessionJson(...args) }))

describe('console-service-accounts', () => {
  beforeEach(() => {
    mockRequestConsoleSessionJson.mockReset()
    window.sessionStorage.clear()
  })

  it('normaliza service account', () => {
    const account = normalizeServiceAccount({ serviceAccountId: 'sa_1', displayName: 'Ops SA', credentials: [{ credentialId: 'cred_1', status: 'active' }] })
    expect(account.serviceAccountId).toBe('sa_1')
    expect(account.credentials[0]?.credentialId).toBe('cred_1')
  })

  it('crea y persiste service account id', async () => {
    mockRequestConsoleSessionJson.mockResolvedValue({ serviceAccountId: 'sa_1' })
    await expect(createServiceAccount('wrk_1', { displayName: 'Ops SA', entityType: 'service_account' })).resolves.toEqual({ serviceAccountId: 'sa_1' })
    expect(window.sessionStorage.getItem('in-falcone.console-service-account-index:wrk_1')).toContain('sa_1')
  })

  it('emite, revoca y rota credenciales', async () => {
    mockRequestConsoleSessionJson.mockResolvedValueOnce({ credentialId: 'cred_1', secret: 'shh' })
    await expect(issueServiceAccountCredential('wrk_1', 'sa_1', { requestedByUserId: 'usr_1' })).resolves.toMatchObject({ credentialId: 'cred_1', secret: 'shh' })
    mockRequestConsoleSessionJson.mockResolvedValueOnce({ ok: true })
    await revokeServiceAccountCredential('wrk_1', 'sa_1', { reason: 'cleanup' })
    mockRequestConsoleSessionJson.mockResolvedValueOnce({ credentialId: 'cred_2', secret: 'rotated' })
    await expect(rotateServiceAccountCredential('wrk_1', 'sa_1', { reason: 'rotate' })).resolves.toMatchObject({ credentialId: 'cred_2' })
  })

  it('rehidrata ids persistidos', async () => {
    window.sessionStorage.setItem('in-falcone.console-service-account-index:wrk_1', JSON.stringify(['sa_1']))
    mockRequestConsoleSessionJson.mockResolvedValue({ serviceAccountId: 'sa_1', displayName: 'Ops SA' })
    const { result } = renderHook(() => useConsoleServiceAccounts('wrk_1'))
    await waitFor(() => expect(result.current.accounts[0]?.serviceAccountId).toBe('sa_1'))
  })
})

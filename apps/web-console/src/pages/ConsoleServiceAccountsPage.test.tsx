import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleServiceAccountsPage } from './ConsoleServiceAccountsPage'

const mockUseConsoleContext = vi.fn()
const mockUseConsoleServiceAccounts = vi.fn()
const mockCreateServiceAccount = vi.fn()
const mockIssueServiceAccountCredential = vi.fn()
const mockRevokeServiceAccountCredential = vi.fn()
const mockRotateServiceAccountCredential = vi.fn()
const mockReadConsoleShellSession = vi.fn()

vi.mock('@/lib/console-context', () => ({ useConsoleContext: () => mockUseConsoleContext() }))
vi.mock('@/lib/console-service-accounts', () => ({
  useConsoleServiceAccounts: (...args: unknown[]) => mockUseConsoleServiceAccounts(...args),
  createServiceAccount: (...args: unknown[]) => mockCreateServiceAccount(...args),
  issueServiceAccountCredential: (...args: unknown[]) => mockIssueServiceAccountCredential(...args),
  revokeServiceAccountCredential: (...args: unknown[]) => mockRevokeServiceAccountCredential(...args),
  rotateServiceAccountCredential: (...args: unknown[]) => mockRotateServiceAccountCredential(...args)
}))
vi.mock('@/lib/console-session', () => ({ readConsoleShellSession: () => mockReadConsoleShellSession() }))

describe('ConsoleServiceAccountsPage', () => {
  beforeEach(() => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { userId: 'usr_1' } })
  })

  afterEach(() => {
    cleanup()
    mockUseConsoleContext.mockReset()
    mockUseConsoleServiceAccounts.mockReset()
    mockCreateServiceAccount.mockReset()
    mockIssueServiceAccountCredential.mockReset()
    mockRevokeServiceAccountCredential.mockReset()
    mockRotateServiceAccountCredential.mockReset()
  })

  it('muestra bloqueo sin workspace', () => {
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: null })
    mockUseConsoleServiceAccounts.mockReturnValue({ accounts: [], loading: false, error: null, reload: vi.fn(), knownIds: [] })
    render(<ConsoleServiceAccountsPage />)
    expect(screen.getByRole('alert')).toHaveTextContent(/selecciona un workspace/i)
  })

  it('crea y emite credencial limpiable', async () => {
    const user = userEvent.setup()
    const reload = vi.fn()
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: 'wrk_1', activeTenant: { state: 'active', label: 'Tenant' }, activeWorkspace: { label: 'Workspace' } })
    mockUseConsoleServiceAccounts.mockReturnValue({ accounts: [{ serviceAccountId: 'sa_1', displayName: 'Ops SA', desiredState: 'active', expiresAt: null, credentialStatus: { state: 'active' }, accessProjection: { effectiveAccess: 'rw', clientState: 'active' } }], loading: false, error: null, reload, knownIds: ['sa_1'] })
    mockCreateServiceAccount.mockResolvedValue({ serviceAccountId: 'sa_2' })
    mockIssueServiceAccountCredential.mockResolvedValue({ credentialId: 'cred_1', secret: 'secret-value', expiresAt: null })
    render(<ConsoleServiceAccountsPage />)
    await user.type(screen.getByLabelText(/nombre de service account/i), 'Nueva SA')
    await user.click(screen.getByRole('button', { name: /^crear$/i }))
    await waitFor(() => expect(mockCreateServiceAccount).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: /emitir/i }))
    expect(await screen.findByRole('dialog', { name: /credencial emitida/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /cerrar/i }))
    expect(screen.queryByText('secret-value')).not.toBeInTheDocument()
  })

  it('deshabilita acciones con tenant inactivo', () => {
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: 'wrk_1', activeTenant: { state: 'suspended' }, activeWorkspace: { label: 'Workspace' } })
    mockUseConsoleServiceAccounts.mockReturnValue({ accounts: [{ serviceAccountId: 'sa_1', displayName: 'Ops SA', desiredState: 'active', expiresAt: null, credentialStatus: { state: 'active' }, accessProjection: { effectiveAccess: 'rw', clientState: 'active' } }], loading: false, error: null, reload: vi.fn(), knownIds: ['sa_1'] })
    render(<ConsoleServiceAccountsPage />)
    expect(screen.getByRole('button', { name: /emitir/i })).toBeDisabled()
  })
})

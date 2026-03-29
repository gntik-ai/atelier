import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConsoleObservabilityPage } from './ConsoleObservabilityPage'

const mockUseConsoleContext = vi.fn()
const mockUseConsoleMetrics = vi.fn()
const mockUseConsoleAuditRecords = vi.fn()
const mockExportAuditRecords = vi.fn()

vi.mock('@/lib/console-context', () => ({ useConsoleContext: () => mockUseConsoleContext() }))
vi.mock('@/lib/console-metrics', () => ({
  useConsoleMetrics: (...args: unknown[]) => mockUseConsoleMetrics(...args),
  useConsoleAuditRecords: (...args: unknown[]) => mockUseConsoleAuditRecords(...args),
  exportAuditRecords: (...args: unknown[]) => mockExportAuditRecords(...args)
}))

describe('ConsoleObservabilityPage', () => {
  afterEach(() => {
    cleanup()
    mockUseConsoleContext.mockReset()
    mockUseConsoleMetrics.mockReset()
    mockUseConsoleAuditRecords.mockReset()
    mockExportAuditRecords.mockReset()
  })

  it('renderiza métricas y cambia rango', async () => {
    const user = userEvent.setup()
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: 'wrk_1', activeTenant: { label: 'Tenant' }, activeWorkspace: { label: 'Workspace' } })
    mockUseConsoleMetrics.mockReturnValue({ overview: { generatedAt: 'now', overallPosture: 'within_limit', dimensions: [{ dimensionId: 'api', displayName: 'API', measuredValue: 5, hardLimit: 10, pctUsed: 50, policyMode: 'enforced', freshnessStatus: 'fresh' }], hasQuotaWarning: false }, loading: false, error: null, reload: vi.fn() })
    mockUseConsoleAuditRecords.mockReturnValue({ records: [], loading: false, error: null, reload: vi.fn() })
    render(<ConsoleObservabilityPage />)
    expect(screen.getByText('API')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText(/rango temporal/i), '7d')
  })

  it('renderiza auditoría, detalle y exportación', async () => {
    const user = userEvent.setup()
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: null, activeTenant: { label: 'Tenant' }, activeWorkspace: null })
    mockUseConsoleMetrics.mockReturnValue({ overview: null, loading: false, error: null, reload: vi.fn() })
    mockUseConsoleAuditRecords.mockReturnValue({ records: [{ eventId: 'evt_1', eventTimestamp: 'now', correlationId: 'corr', actor: { actorId: 'usr_1', actorType: 'tenant_user', displayName: 'User' }, action: { actionId: 'create', category: 'resource_creation' }, resource: null, result: { outcome: 'succeeded' }, origin: { ipAddress: '127.0.0.1' }, scope: null, metadata: null }], loading: false, error: null, reload: vi.fn() })
    render(<ConsoleObservabilityPage />)
    await user.click(screen.getByRole('button', { name: 'Audit' }))
    await user.click(screen.getByRole('button', { name: 'evt_1' }))
    expect(screen.getByText(/correlation/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /exportar/i }))
    await waitFor(() => expect(mockExportAuditRecords).toHaveBeenCalled())
  })
})

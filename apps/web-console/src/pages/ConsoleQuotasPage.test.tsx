import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConsoleQuotasPage } from './ConsoleQuotasPage'

const mockUseConsoleContext = vi.fn()
const mockUseConsoleQuotas = vi.fn()
const mockReadConsoleShellSession = vi.fn()

vi.mock('@/lib/console-context', () => ({ useConsoleContext: () => mockUseConsoleContext() }))
vi.mock('@/lib/console-quotas', () => ({ useConsoleQuotas: (...args: unknown[]) => mockUseConsoleQuotas(...args) }))
vi.mock('@/lib/console-session', () => ({ readConsoleShellSession: () => mockReadConsoleShellSession() }))

describe('ConsoleQuotasPage', () => {
  afterEach(() => {
    cleanup()
    mockUseConsoleContext.mockReset()
    mockUseConsoleQuotas.mockReset()
  })

  it('renderiza warning, exceeded y CTA superadmin', () => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['platform_operator'] } })
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeTenant: { label: 'Tenant' }, activeWorkspaceId: 'wrk_1' })
    mockUseConsoleQuotas.mockReturnValue({ posture: { overallPosture: 'warning_threshold_reached', evaluatedAt: 'now', dimensions: [{ dimensionId: 'api', displayName: 'API', hardLimit: 10, softLimit: null, measuredValue: 8, remainingToHardLimit: 2, pctUsed: 80, policyMode: 'enforced', freshnessStatus: 'fresh', isWarning: true, isExceeded: false }, { dimensionId: 'storage', displayName: 'Storage', hardLimit: 10, softLimit: null, measuredValue: 11, remainingToHardLimit: 0, pctUsed: 110, policyMode: 'enforced', freshnessStatus: 'fresh', isWarning: false, isExceeded: true }], generatedAt: 'now', hardLimitDimensions: [] }, workspacePosture: null, loading: false, error: null, reload: vi.fn() })
    render(<ConsoleQuotasPage />)
    expect(screen.getByText('API')).toBeInTheDocument()
    expect(screen.getByText('Storage')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /ajustar cuota/i }).length).toBeGreaterThan(0)
  })
})

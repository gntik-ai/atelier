import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CreateTenantWizard } from './CreateTenantWizard'

const requestMock = vi.fn()
const readConsoleShellSessionMock = vi.fn()
const useConsoleQuotasMock = vi.fn()

vi.mock('@/lib/console-session', () => ({
  readConsoleShellSession: () => readConsoleShellSessionMock(),
  requestConsoleSessionJson: (...args: unknown[]) => requestMock(...args)
}))
vi.mock('@/lib/console-quotas', () => ({ useConsoleQuotas: () => useConsoleQuotasMock() }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  requestMock.mockReset()
  readConsoleShellSessionMock.mockReset()
  useConsoleQuotasMock.mockReset()
  readConsoleShellSessionMock.mockReturnValue({ principal: { platformRoles: ['superadmin'] } })
  useConsoleQuotasMock.mockReturnValue({ posture: null, workspacePosture: null, loading: false })
})

describe('CreateTenantWizard', () => {
  it('envía el payload esperado', async () => {
    requestMock.mockResolvedValue({ tenantId: 'ten_new' })
    const user = userEvent.setup()
    render(<MemoryRouter><CreateTenantWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    await user.type(screen.getByLabelText(/nombre del tenant/i), 'Tenant Nuevo')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.selectOptions(screen.getByLabelText(/^plan$/i), 'starter')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.selectOptions(screen.getByLabelText(/región/i), 'eu-west')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /confirmar/i }))
    expect(requestMock).toHaveBeenCalledWith('/v1/admin/tenants', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ name: 'Tenant Nuevo', planId: 'starter', region: 'eu-west' }) }))
  })

  it('[RW-07] cuota excedida bloquea el wizard con aviso — RF-UI-025 / T02-AC7', async () => {
    const user = userEvent.setup()
    useConsoleQuotasMock.mockReturnValue({
      posture: { dimensions: [{ dimensionId: 'tenants.count', isExceeded: true, remainingToHardLimit: 0 }] },
      workspacePosture: null,
      loading: false
    })

    render(<MemoryRouter><CreateTenantWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    await user.type(screen.getByLabelText(/nombre del tenant/i), 'Tenant Nuevo')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))

    expect(screen.queryByText(/sin cuota disponible/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeDisabled()
    expect(screen.getByLabelText(/plan/i)).toBeInTheDocument()
  })

  it('[RW-08] sin permisos muestra mensaje de permisos insuficientes — RF-UI-025 / T02-AC8', () => {
    readConsoleShellSessionMock.mockReturnValue({ principal: { platformRoles: ['member'] } })

    render(<MemoryRouter><CreateTenantWizard open onOpenChange={vi.fn()} /></MemoryRouter>)

    expect(screen.getByText(/acceso bloqueado/i)).toBeInTheDocument()
  })
})

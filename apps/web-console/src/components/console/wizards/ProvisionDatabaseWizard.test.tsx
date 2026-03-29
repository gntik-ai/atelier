import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProvisionDatabaseWizard } from './ProvisionDatabaseWizard'

const requestMock = vi.fn()
const readConsoleShellSessionMock = vi.fn()
const useConsoleQuotasMock = vi.fn()

vi.mock('@/lib/console-context', () => ({ useConsoleContext: () => ({ activeTenantId: 'ten_alpha', activeWorkspaceId: 'wrk_a1' }) }))
vi.mock('@/lib/console-session', () => ({ readConsoleShellSession: () => readConsoleShellSessionMock(), requestConsoleSessionJson: (...args: unknown[]) => requestMock(...args) }))
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

describe('ProvisionDatabaseWizard', () => {
  it('[RW-02] bloqueo por validación — RF-UI-025 / T02-AC2', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><ProvisionDatabaseWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeDisabled()
  })

  it('[RW-05] confirmación exitosa muestra feedback — RF-UI-025 / T02-AC5', async () => {
    const user = userEvent.setup()
    requestMock.mockResolvedValue({ databaseId: 'db_new' })
    render(<MemoryRouter><ProvisionDatabaseWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.type(screen.getByLabelText(/nombre/i), 'orders')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /confirmar/i }))
    expect(await screen.findByText(/recurso creado correctamente/i)).toBeInTheDocument()
    expect(screen.getByText(/db_new/i)).toBeInTheDocument()
  })

  it('[RW-06] error backend preserva datos — RF-UI-025 / T02-AC6', async () => {
    const user = userEvent.setup()
    requestMock.mockRejectedValue(new Error('db failed'))
    render(<MemoryRouter><ProvisionDatabaseWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.type(screen.getByLabelText(/nombre/i), 'orders')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /confirmar/i }))
    expect(await screen.findByText(/db failed/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /anterior/i }))
    await user.click(screen.getByRole('button', { name: /anterior/i }))
    expect(screen.getByLabelText(/nombre/i)).toHaveValue('orders')
  })

  it('[RW-07] cuota de bases de datos excedida bloquea el wizard — RF-UI-025 / T02-AC7', async () => {
    const user = userEvent.setup()
    useConsoleQuotasMock.mockReturnValue({ posture: null, workspacePosture: { dimensions: [{ dimensionId: 'databases.count', isExceeded: true, remainingToHardLimit: 0 }] }, loading: false })
    render(<MemoryRouter><ProvisionDatabaseWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.type(screen.getByLabelText(/nombre/i), 'orders')
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeDisabled()
    expect(screen.getByText(/la cuota disponible para este recurso está agotada/i)).toBeInTheDocument()
  })

  it('[RW-08] sin permisos muestra mensaje de permisos insuficientes — RF-UI-025 / T02-AC8', () => {
    readConsoleShellSessionMock.mockReturnValue({ principal: { platformRoles: ['member'] } })
    render(<MemoryRouter><ProvisionDatabaseWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    expect(screen.getByText(/acceso bloqueado/i)).toBeInTheDocument()
  })
})

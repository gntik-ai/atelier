import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CreateWorkspaceWizard } from './CreateWorkspaceWizard'

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

describe('CreateWorkspaceWizard', () => {
  it('[RW-01] happy path confirma creación — RF-UI-025 / T02-AC1', async () => {
    const user = userEvent.setup()
    requestMock.mockResolvedValue({ workspaceId: 'wrk_new' })
    render(<MemoryRouter><CreateWorkspaceWizard open onOpenChange={vi.fn()} /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.type(screen.getByLabelText(/nombre del workspace/i), 'Workspace Nuevo')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.type(screen.getByLabelText(/descripción/i), 'Workspace principal')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /confirmar/i }))

    expect(requestMock).toHaveBeenCalledWith('/v1/tenants/ten_alpha/workspaces', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ name: 'Workspace Nuevo' }) }))
    expect(await screen.findByText(/recurso creado correctamente/i)).toBeInTheDocument()
  })

  it('[RW-02] bloqueo por validación — RF-UI-025 / T02-AC2', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><CreateWorkspaceWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeDisabled()
  })

  it('[RW-06] error de backend preserva datos — RF-UI-025 / T02-AC6', async () => {
    const user = userEvent.setup()
    requestMock.mockRejectedValue(new Error('workspace failed'))
    render(<MemoryRouter><CreateWorkspaceWizard open onOpenChange={vi.fn()} /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.type(screen.getByLabelText(/nombre del workspace/i), 'Workspace Nuevo')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /confirmar/i }))

    expect(await screen.findByText(/workspace failed/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /anterior/i }))
    await user.click(screen.getByRole('button', { name: /anterior/i }))
    expect(screen.getByLabelText(/nombre del workspace/i)).toHaveValue('Workspace Nuevo')
  })

  it('[RW-07] cuota excedida bloquea el wizard — RF-UI-025 / T02-AC7', async () => {
    const user = userEvent.setup()
    useConsoleQuotasMock.mockReturnValue({ posture: { dimensions: [{ dimensionId: 'workspaces.count', isExceeded: true, remainingToHardLimit: 0 }] }, workspacePosture: null, loading: false })
    render(<MemoryRouter><CreateWorkspaceWizard open onOpenChange={vi.fn()} /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.type(screen.getByLabelText(/nombre del workspace/i), 'Workspace Nuevo')
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeDisabled()
    expect(screen.getByText(/la cuota disponible para este recurso está agotada/i)).toBeInTheDocument()
  })

  it('[RW-08] sin permisos muestra mensaje de permisos insuficientes — RF-UI-025 / T02-AC8', () => {
    readConsoleShellSessionMock.mockReturnValue({ principal: { platformRoles: ['member'] } })
    render(<MemoryRouter><CreateWorkspaceWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    expect(screen.getByText(/acceso bloqueado/i)).toBeInTheDocument()
  })
})

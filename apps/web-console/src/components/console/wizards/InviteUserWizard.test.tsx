import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InviteUserWizard } from './InviteUserWizard'

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

describe('InviteUserWizard', () => {
  it('[RW-01] navega adelante y atrás preservando el email — RF-UI-025 / T02-AC1', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><InviteUserWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.type(screen.getByLabelText(/email/i), 'user@example.com')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /anterior/i }))
    expect(screen.getByLabelText(/email/i)).toHaveValue('user@example.com')
  })

  it('[RW-03] resumen muestra email y rol — RF-UI-025 / T02-AC3', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><InviteUserWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.type(screen.getByLabelText(/email/i), 'user@example.com')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.selectOptions(screen.getByLabelText(/^rol$/i), 'workspace_admin')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    expect(screen.getByText(/user@example.com/i)).toBeInTheDocument()
    expect(screen.getByText(/workspace_admin/i)).toBeInTheDocument()
  })

  it('[RW-04] desde resumen vuelve al paso de mensaje — RF-UI-025 / T02-AC4', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><InviteUserWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.type(screen.getByLabelText(/email/i), 'user@example.com')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.selectOptions(screen.getByLabelText(/^rol$/i), 'workspace_admin')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /anterior/i }))
    expect(screen.getByLabelText(/mensaje/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeEnabled()
  })

  it('[RW-06] error backend preserva email y rol — RF-UI-025 / T02-AC6', async () => {
    const user = userEvent.setup()
    requestMock.mockRejectedValue(new Error('invite failed'))
    render(<MemoryRouter><InviteUserWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.type(screen.getByLabelText(/email/i), 'user@example.com')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.selectOptions(screen.getByLabelText(/^rol$/i), 'workspace_admin')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /confirmar/i }))
    expect(await screen.findByText(/invite failed/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /anterior/i }))
    await user.click(screen.getByRole('button', { name: /anterior/i }))
    expect(screen.getByLabelText(/^rol$/i)).toHaveValue('workspace_admin')
    await user.click(screen.getByRole('button', { name: /anterior/i }))
    expect(screen.getByLabelText(/email/i)).toHaveValue('user@example.com')
  })

  it('[RW-08] sin permisos muestra mensaje de permisos insuficientes — RF-UI-025 / T02-AC8', () => {
    readConsoleShellSessionMock.mockReturnValue({ principal: { platformRoles: ['member'] } })
    render(<MemoryRouter><InviteUserWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    expect(screen.getByText(/acceso bloqueado/i)).toBeInTheDocument()
  })
})

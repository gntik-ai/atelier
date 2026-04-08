import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CreateIamClientWizard } from './CreateIamClientWizard'

const requestMock = vi.fn()
const readConsoleShellSessionMock = vi.fn()

vi.mock('@/lib/console-context', () => ({ useConsoleContext: () => ({ activeWorkspaceId: 'wrk_a1', activeTenantId: 'ten_alpha' }) }))
vi.mock('@/lib/console-session', () => ({ readConsoleShellSession: () => readConsoleShellSessionMock(), requestConsoleSessionJson: (...args: unknown[]) => requestMock(...args) }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  requestMock.mockReset()
  readConsoleShellSessionMock.mockReset()
  readConsoleShellSessionMock.mockReturnValue({ principal: { platformRoles: ['superadmin'] } })
})

describe('CreateIamClientWizard', () => {
  it('[RW-02] bloqueo por validación — RF-UI-025 / T02-AC2', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><CreateIamClientWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeDisabled()
  })

  it('[RW-05] confirmación exitosa muestra feedback — RF-UI-025 / T02-AC5', async () => {
    const user = userEvent.setup()
    requestMock.mockResolvedValue({ iamClientId: 'client_new' })
    render(<MemoryRouter><CreateIamClientWizard open onOpenChange={vi.fn()} /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.selectOptions(screen.getByLabelText(/tipo/i), 'public')
    await user.type(screen.getByLabelText(/client id/i), 'falcone-console')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.type(screen.getByLabelText(/redirect uris/i), 'https://app.example/callback')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /confirmar/i }))

    expect(requestMock).toHaveBeenCalled()
    expect(await screen.findByText(/recurso creado correctamente/i)).toBeInTheDocument()
    expect(screen.getByText(/client_new/i)).toBeInTheDocument()
  })

  it('[RW-06] error de backend preserva datos — RF-UI-025 / T02-AC6', async () => {
    const user = userEvent.setup()
    requestMock.mockRejectedValue(new Error('iam failed'))
    render(<MemoryRouter><CreateIamClientWizard open onOpenChange={vi.fn()} /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.selectOptions(screen.getByLabelText(/tipo/i), 'public')
    await user.type(screen.getByLabelText(/client id/i), 'falcone-console')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.type(screen.getByLabelText(/redirect uris/i), 'https://app.example/callback')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /confirmar/i }))

    expect(await screen.findByText(/iam failed/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /anterior/i }))
    await user.click(screen.getByRole('button', { name: /anterior/i }))
    await user.click(screen.getByRole('button', { name: /anterior/i }))
    expect(screen.getByLabelText(/client id/i)).toHaveValue('falcone-console')
  })

  it('[RW-08] sin permisos muestra mensaje de permisos insuficientes — RF-UI-025 / T02-AC8', () => {
    readConsoleShellSessionMock.mockReturnValue({ principal: { platformRoles: ['member'] } })
    render(<MemoryRouter><CreateIamClientWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    expect(screen.getByText(/acceso bloqueado/i)).toBeInTheDocument()
  })
})

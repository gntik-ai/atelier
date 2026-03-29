import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { CreateTenantWizard } from './CreateTenantWizard'

const requestMock = vi.fn()
vi.mock('@/lib/console-session', () => ({ readConsoleShellSession: () => ({ principal: { platformRoles: ['superadmin'] } }), requestConsoleSessionJson: (...args: unknown[]) => requestMock(...args) }))
vi.mock('@/lib/console-quotas', () => ({ useConsoleQuotas: () => ({ posture: null, workspacePosture: null, loading: false }) }))

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
})

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ConsoleTenantsPage } from './ConsoleTenantsPage'

vi.mock('@/lib/console-session', () => ({ readConsoleShellSession: () => ({ principal: { platformRoles: ['superadmin'] } }), requestConsoleSessionJson: vi.fn() }))
vi.mock('@/lib/console-quotas', () => ({ useConsoleQuotas: () => ({ posture: null, workspacePosture: null, loading: false }) }))

describe('ConsoleTenantsPage', () => {
  it('abre el wizard desde el CTA principal', async () => {
    const user = userEvent.setup()
    render(<ConsoleTenantsPage />)
    await user.click(screen.getByRole('button', { name: /nuevo tenant/i }))
    expect(screen.getByRole('heading', { name: /nuevo tenant/i })).toBeInTheDocument()
  })
})

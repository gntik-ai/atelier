import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/actions/secretRotationActions', () => ({ revokeSecretVersion: vi.fn().mockResolvedValue({ revokedVersion: 1, effectiveAt: '2026-03-31T00:00:00.000Z' }) }))

import { ConsoleSecretsPage, SecretVersionBadge } from './ConsoleSecretsPage'

describe('ConsoleSecretsPage', () => {
  it('renders secrets table', () => {
    render(<MemoryRouter><ConsoleSecretsPage /></MemoryRouter>)
    expect(screen.getByText('Secrets')).toBeInTheDocument()
    expect(screen.getByText('app-password')).toBeInTheDocument()
  })

  it('renders badge styles per state', () => {
    const { container } = render(<SecretVersionBadge state="active" />)
    expect(container.textContent).toContain('active')
  })

  it('opens revoke dialog', () => {
    render(<MemoryRouter><ConsoleSecretsPage /></MemoryRouter>)
    fireEvent.click(screen.getAllByText('Revoke')[0])
    expect(screen.getByText('Revoke secret version')).toBeInTheDocument()
  })
})

import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConsoleBackupScopePage } from '@/pages/ConsoleBackupScopePage'
import { mockBackupScopeMatrix, mockTenantBackupScope } from './fixtures/backupScopeFixtures'

afterEach(cleanup)

describe('ConsoleBackupScopePage', () => {
  it('shows loading state initially', () => {
    const fetcher = vi.fn(() => new Promise(() => {})) // never resolves
    render(<ConsoleBackupScopePage role="superadmin" adminFetcher={fetcher} />)
    expect(screen.getByTestId('matrix-loading')).toBeInTheDocument()
  })

  it('renders matrix after data loads (admin)', async () => {
    const fetcher = vi.fn(() => Promise.resolve(mockBackupScopeMatrix))
    render(<ConsoleBackupScopePage role="superadmin" adminFetcher={fetcher} />)

    await waitFor(() => {
      expect(screen.getByTestId('backup-scope-matrix')).toBeInTheDocument()
    })
    expect(screen.getAllByTestId(/^matrix-row-/)).toHaveLength(7)
  })

  it('profile tab click triggers fetch with correct profile param', async () => {
    const fetcher = vi.fn(() => Promise.resolve(mockBackupScopeMatrix))
    render(<ConsoleBackupScopePage role="superadmin" adminFetcher={fetcher} />)

    await waitFor(() => {
      expect(screen.getByTestId('backup-scope-matrix')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('profile-tab-ha'))

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith('ha')
    })
  })

  it('shows error message when API rejects', async () => {
    const fetcher = vi.fn(() => Promise.reject(new Error('Network error')))
    render(<ConsoleBackupScopePage role="superadmin" adminFetcher={fetcher} />)

    await waitFor(() => {
      expect(screen.getByTestId('scope-error')).toBeInTheDocument()
    })
    expect(screen.getByText(/Network error/)).toBeInTheDocument()
  })

  it('renders tenant view when role is tenant:owner', async () => {
    const tenantFetcher = vi.fn(() => Promise.resolve(mockTenantBackupScope))
    render(
      <ConsoleBackupScopePage
        role="tenant:owner"
        tenantId="ten-xyz"
        tenantFetcher={tenantFetcher}
        adminFetcher={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('backup-scope-matrix')).toBeInTheDocument()
    })
    expect(tenantFetcher).toHaveBeenCalledWith('ten-xyz')
  })

  it('does not show profile selector for tenant role', async () => {
    const tenantFetcher = vi.fn(() => Promise.resolve(mockTenantBackupScope))
    render(
      <ConsoleBackupScopePage
        role="tenant:owner"
        tenantId="ten-xyz"
        tenantFetcher={tenantFetcher}
        adminFetcher={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('backup-scope-matrix')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('profile-selector')).not.toBeInTheDocument()
  })
})

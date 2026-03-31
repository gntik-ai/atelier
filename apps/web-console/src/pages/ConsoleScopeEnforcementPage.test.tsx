import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConsoleScopeEnforcementPage } from './ConsoleScopeEnforcementPage'

vi.mock('@/lib/console-scope-enforcement', () => ({
  fetchDenials: vi.fn(async () => ({ denials: [
    { tenant_id: 'tenant-1', actor_id: 'actor-1', actor_type: 'user', denial_type: 'CONFIG_ERROR', http_method: 'GET', request_path: '/v1/workspaces/ws-1', correlation_id: 'corr-1', denied_at: '2026-03-31T00:00:00Z' },
    { tenant_id: 'tenant-1', actor_id: 'actor-1', actor_type: 'user', denial_type: 'SCOPE_INSUFFICIENT', http_method: 'POST', request_path: '/v1/functions/1/deploy', correlation_id: 'corr-2', denied_at: '2026-03-31T00:10:00Z' }
  ], nextCursor: null, totalInWindow: 2 }))
}))

describe('ConsoleScopeEnforcementPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders summary strip with correct counts', async () => {
    render(<ConsoleScopeEnforcementPage isSuperadmin />)
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())
    expect(screen.getByText(/Scope Enforcement — Denial Events/)).toBeInTheDocument()
  })

  it('shows config error banner only for superadmin', async () => {
    const { rerender } = render(<ConsoleScopeEnforcementPage isSuperadmin />)
    await waitFor(() => expect(screen.getByText(/Unconfigured endpoints detected/)).toBeInTheDocument())
    rerender(<ConsoleScopeEnforcementPage isSuperadmin={false} />)
    await waitFor(() => expect(screen.queryByText(/Unconfigured endpoints detected/)).toBeNull())
  })

  it('refresh triggers a new fetch', async () => {
    const { fetchDenials } = await import('@/lib/console-scope-enforcement')
    render(<ConsoleScopeEnforcementPage isSuperadmin />)
    await waitFor(() => expect(fetchDenials).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByText('Refresh'))
    await waitFor(() => expect(fetchDenials).toHaveBeenCalledTimes(2))
  })

  it('date filter change triggers new query', async () => {
    const { fetchDenials } = await import('@/lib/console-scope-enforcement')
    render(<ConsoleScopeEnforcementPage isSuperadmin />)
    await waitFor(() => expect(fetchDenials).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('from-range'), { target: { value: '2026-03-30' } })
    await waitFor(() => expect((fetchDenials as any).mock.calls.length).toBeGreaterThan(1))
  })
})

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ScopeEnforcementDenialsTable } from './ScopeEnforcementDenialsTable'

const rows = [{ tenant_id: 'tenant-1', actor_id: 'actor-1', actor_type: 'user', denial_type: 'SCOPE_INSUFFICIENT', http_method: 'POST', request_path: '/v1/functions/1/deploy', missing_scopes: ['functions:deploy'], correlation_id: 'corr-1', denied_at: '2026-03-31T00:00:00Z', source_ip: '127.0.0.1' }]

describe('ScopeEnforcementDenialsTable', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:demo'), revokeObjectURL: vi.fn() } as any)
  })

  it('renders denial rows correctly', () => {
    render(<ScopeEnforcementDenialsTable denials={rows as any} isLoading={false} hasMore={false} isSuperadmin />)
    expect(screen.getByText('SCOPE_INSUFFICIENT')).toBeInTheDocument()
    expect(screen.getByText(/POST \/v1\/functions\/1\/deploy/)).toBeInTheDocument()
  })

  it('hides tenant column when not superadmin', () => {
    render(<ScopeEnforcementDenialsTable denials={rows as any} isLoading={false} hasMore={false} isSuperadmin={false} />)
    expect(screen.queryByText('Tenant')).toBeNull()
  })

  it('export csv button triggers download', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<ScopeEnforcementDenialsTable denials={rows as any} isLoading={false} hasMore={false} isSuperadmin />)
    fireEvent.click(screen.getByText('Export CSV'))
    expect(click).toHaveBeenCalled()
    click.mockRestore()
  })

  it('load more button calls onLoadMore', () => {
    const onLoadMore = vi.fn()
    render(<ScopeEnforcementDenialsTable denials={rows as any} isLoading={false} hasMore isSuperadmin onLoadMore={onLoadMore} />)
    fireEvent.click(screen.getByText('Load more'))
    expect(onLoadMore).toHaveBeenCalled()
  })

  it('renders empty state', () => {
    render(<ScopeEnforcementDenialsTable denials={[]} isLoading={false} hasMore={false} isSuperadmin />)
    expect(screen.getByText('No denial events in this period')).toBeInTheDocument()
  })
})

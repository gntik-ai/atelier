import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceAllocationSummaryTable } from './WorkspaceAllocationSummaryTable'

afterEach(cleanup)

describe('WorkspaceAllocationSummaryTable', () => {
  it('renders allocation summary rows', () => {
    render(<WorkspaceAllocationSummaryTable rows={[{ dimensionKey: 'max_pg_databases', displayLabel: 'PostgreSQL Databases', tenantEffectiveValue: 20, totalAllocated: 13, unallocated: 7, workspaces: [{ workspaceId: 'ws-prod', allocatedValue: 8 }], isFullyAllocated: false }]} />)
    expect(screen.getByText('PostgreSQL Databases')).toBeInTheDocument()
    expect(screen.getByText('ws-prod: 8')).toBeInTheDocument()
  })
})

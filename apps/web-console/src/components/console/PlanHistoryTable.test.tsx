import { afterEach, cleanup, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlanHistoryTable } from './PlanHistoryTable'

describe('PlanHistoryTable', () => {
  it('renders Current for active assignment rows', () => {
    render(<PlanHistoryTable items={[{ assignmentId: 'a1', tenantId: 't1', planId: 'p1', effectiveFrom: '2026-03-31', supersededAt: null, assignedBy: 'usr_1' }]} page={1} pageSize={10} total={1} />)
    expect(screen.getByText('Current')).toBeInTheDocument()
  })
})

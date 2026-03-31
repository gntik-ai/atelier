import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { QuotaConsumptionTable } from './QuotaConsumptionTable'

afterEach(cleanup)

const rows = [{ dimensionKey: 'max_workspaces', displayLabel: 'Workspaces', effectiveValue: 10, source: 'override' as const, currentUsage: 8, usageStatus: 'approaching_limit' as const, originalPlanValue: 5 }]

describe('QuotaConsumptionTable', () => {
  it('renders rows and override indicator', () => {
    render(<QuotaConsumptionTable rows={rows} showOverrideDetails />)
    expect(screen.getByText('Workspaces')).toBeInTheDocument()
    expect(screen.getByText('Override')).toBeInTheDocument()
  })
})

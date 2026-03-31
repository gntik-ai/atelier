import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PlanLimitsTable } from './PlanLimitsTable'

const rows = [{ dimensionKey: 'requests', displayLabel: 'Requests', defaultValue: 100, effectiveValue: -1, explicitValue: -1, source: 'unlimited' as const, unit: 'req' }]

describe('PlanLimitsTable', () => {
  it('renders unlimited and editable states', () => {
    const onRemove = vi.fn()
    render(<PlanLimitsTable dimensions={rows} editable onRemove={onRemove} />)
    expect(screen.getByLabelText(/requests-value/i)).toBeInTheDocument()
    screen.getByRole('button', { name: /reset/i }).click()
    expect(onRemove).toHaveBeenCalledWith('requests')
  })
})

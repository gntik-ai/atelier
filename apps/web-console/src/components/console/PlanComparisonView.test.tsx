import { afterEach, cleanup, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlanComparisonView } from './PlanComparisonView'

describe('PlanComparisonView', () => {
  it('marks increased decreased and unchanged rows', () => {
    render(<PlanComparisonView currentPlan={[{ dimensionKey: 'a', displayLabel: 'A', defaultValue: 0, effectiveValue: 1, source: 'explicit' as const } as any, { dimensionKey: 'b', displayLabel: 'B', defaultValue: 0, effectiveValue: 5, source: 'explicit' as const } as any, { dimensionKey: 'c', displayLabel: 'C', defaultValue: 0, effectiveValue: 3, source: 'explicit' as const } as any]} targetPlan={[{ dimensionKey: 'a', displayLabel: 'A', defaultValue: 0, effectiveValue: 2, source: 'explicit' as const } as any, { dimensionKey: 'b', displayLabel: 'B', defaultValue: 0, effectiveValue: 1, source: 'explicit' as const } as any, { dimensionKey: 'c', displayLabel: 'C', defaultValue: 0, effectiveValue: 3, source: 'explicit' as const } as any]} />)
    expect(screen.getByText('increased')).toBeInTheDocument()
    expect(screen.getByText('decreased')).toBeInTheDocument()
    expect(screen.getByText('unchanged')).toBeInTheDocument()
  })
})

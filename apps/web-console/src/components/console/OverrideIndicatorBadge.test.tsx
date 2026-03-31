import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { OverrideIndicatorBadge } from './OverrideIndicatorBadge'

afterEach(cleanup)

describe('OverrideIndicatorBadge', () => {
  it('renders badge and tooltip text via title', () => {
    render(<OverrideIndicatorBadge overriddenFromValue={5} overrideValue={10} />)
    expect(screen.getByText('Override')).toHaveAttribute('title', 'Plan: 5 → Override: 10')
  })
})

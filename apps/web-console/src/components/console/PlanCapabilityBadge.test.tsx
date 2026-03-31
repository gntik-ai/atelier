import { afterEach, cleanup, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlanCapabilityBadge } from './PlanCapabilityBadge'

describe('PlanCapabilityBadge', () => {
  it('renders accessible enabled and disabled states', () => {
    render(<div><PlanCapabilityBadge enabled label='Feature A' /><PlanCapabilityBadge enabled={false} label='Feature B' /></div>)
    expect(screen.getByLabelText(/feature a enabled/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/feature b disabled/i)).toBeInTheDocument()
  })
})

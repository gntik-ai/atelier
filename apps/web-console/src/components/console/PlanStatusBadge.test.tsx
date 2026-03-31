import { afterEach, cleanup, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlanStatusBadge } from './PlanStatusBadge'

describe('PlanStatusBadge', () => {
  it('renders all statuses', () => {
    render(<div><PlanStatusBadge status='draft' /><PlanStatusBadge status='active' /><PlanStatusBadge status='deprecated' /><PlanStatusBadge status='archived' /></div>)
    expect(screen.getByText('draft')).toBeInTheDocument()
    expect(screen.getByText('active')).toBeInTheDocument()
    expect(screen.getByText('deprecated')).toBeInTheDocument()
    expect(screen.getByText('archived')).toBeInTheDocument()
  })
})

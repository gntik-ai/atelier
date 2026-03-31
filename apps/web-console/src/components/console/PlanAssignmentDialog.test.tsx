import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PlanAssignmentDialog } from './PlanAssignmentDialog'

describe('PlanAssignmentDialog', () => {
  it('shows only active plans and confirms selection', async () => {
    const onConfirm = vi.fn()
    render(<PlanAssignmentDialog open tenantId='ten_1' currentPlanId={null} activePlans={[{ id: 'p1', displayName: 'Plan 1', status: 'active' }, { id: 'p2', displayName: 'Plan 2', status: 'deprecated' }]} onConfirm={onConfirm} onCancel={() => {}} />)
    expect(screen.getByRole('option', { name: /plan 1/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /plan 2/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))
    expect(onConfirm).toHaveBeenCalledWith('p1')
  })
})

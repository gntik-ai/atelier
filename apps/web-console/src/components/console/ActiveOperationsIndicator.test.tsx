import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ActiveOperationsIndicator } from './ActiveOperationsIndicator'

const mockUseActiveOperationsCount = vi.fn()

vi.mock('@/lib/console-operations', () => ({
  useActiveOperationsCount: () => mockUseActiveOperationsCount()
}))

describe('ActiveOperationsIndicator', () => {
  beforeEach(() => {
    mockUseActiveOperationsCount.mockReset()
  })

  it('F11 renders badge and link when count is greater than zero', () => {
    mockUseActiveOperationsCount.mockReturnValue({ count: 3, isLoading: false })

    render(
      <MemoryRouter>
        <ActiveOperationsIndicator />
      </MemoryRouter>
    )

    expect(screen.getByLabelText('Operaciones activas: 3')).toHaveAttribute('href', '/console/operations')
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('F12 renders nothing when count is zero', () => {
    mockUseActiveOperationsCount.mockReturnValue({ count: 0, isLoading: false })

    const { container } = render(
      <MemoryRouter>
        <ActiveOperationsIndicator />
      </MemoryRouter>
    )

    expect(container).toBeEmptyDOMElement()
  })
})

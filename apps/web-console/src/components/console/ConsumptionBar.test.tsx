import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ConsumptionBar } from './ConsumptionBar'

afterEach(cleanup)

describe('ConsumptionBar', () => {
  it('renders within-limit usage', () => {
    render(<ConsumptionBar current={30} limit={100} />)
    expect(screen.getByText('30 / 100')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('renders unavailable usage', () => {
    render(<ConsumptionBar current={null} limit={100} />)
    expect(screen.getByText('Data unavailable')).toBeInTheDocument()
  })

  it('renders unlimited usage without progressbar', () => {
    render(<ConsumptionBar current={12} limit={-1} />)
    expect(screen.getByText('/ Unlimited')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })
})

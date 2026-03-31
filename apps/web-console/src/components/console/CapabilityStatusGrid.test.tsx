import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CapabilityStatusGrid } from './CapabilityStatusGrid'

afterEach(cleanup)

describe('CapabilityStatusGrid', () => {
  it('renders enabled and disabled capabilities', () => {
    render(<CapabilityStatusGrid capabilities={[{ capabilityKey: 'realtime', displayLabel: 'Realtime', enabled: true, source: 'plan' }, { capabilityKey: 'webhooks', displayLabel: 'Webhooks', enabled: false, source: 'catalog_default' }]} />)
    expect(screen.getByText('Realtime')).toBeInTheDocument()
    expect(screen.getByText('Enabled')).toBeInTheDocument()
    expect(screen.getByText('Disabled')).toBeInTheDocument()
  })
})

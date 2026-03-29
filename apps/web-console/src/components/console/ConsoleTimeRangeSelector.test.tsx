import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ConsoleTimeRangeSelector } from './ConsoleTimeRangeSelector'

describe('ConsoleTimeRangeSelector', () => {
  it('permite cambiar de preset y mostrar campos custom', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ConsoleTimeRangeSelector value={{ preset: '24h' }} onChange={onChange} />)

    await user.selectOptions(screen.getByLabelText(/rango temporal/i), 'custom')
    expect(onChange).toHaveBeenCalled()
  })
})

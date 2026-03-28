import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { WelcomePage } from './WelcomePage'

describe('WelcomePage', () => {
  it('renderiza el contenido fundacional de la consola', () => {
    render(
      <MemoryRouter>
        <WelcomePage />
      </MemoryRouter>
    )

    const heading = screen.getByRole('heading', { level: 1, name: /in atelier console/i })
    expect(heading).toBeInTheDocument()
    expect(screen.getByText(/consola administrativa del producto baas multi-tenant/i)).toBeInTheDocument()
    expect(screen.getByText(/fundación de consola lista/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ir al login/i })).toHaveAttribute('href', '/login')
    expect(screen.getByRole('link', { name: /ver alcance inicial/i })).toHaveAttribute('href', '#foundation-overview')
  })
})

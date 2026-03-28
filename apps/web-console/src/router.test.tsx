import { cleanup, render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import { appRoutes } from './router'

afterEach(() => {
  cleanup()
})

describe('router', () => {
  it('renderiza la página de bienvenida en la ruta raíz', async () => {
    const router = createMemoryRouter(appRoutes, {
      initialEntries: ['/']
    })

    render(<RouterProvider router={router} />)

    expect(await screen.findByRole('heading', { level: 1, name: /in atelier console/i })).toBeInTheDocument()
  })

  it('renderiza la página no encontrada para rutas inexistentes', async () => {
    const router = createMemoryRouter(appRoutes, {
      initialEntries: ['/ruta-inexistente']
    })

    render(<RouterProvider router={router} />)

    expect(await screen.findByRole('heading', { level: 1, name: /página no encontrada/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /volver al inicio/i })).toHaveAttribute('href', '/')
  })
})

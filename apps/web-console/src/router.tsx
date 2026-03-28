import { createBrowserRouter } from 'react-router-dom'

import { NotFoundPage } from '@/pages/NotFoundPage'
import { WelcomePage } from '@/pages/WelcomePage'

// T01 declara únicamente la ruta raíz y el fallback.
// Las rutas con shell, login y navegación protegida se añadirán en T04/T05.
export const appRoutes = [
  {
    path: '/',
    element: <WelcomePage />
  },
  {
    path: '*',
    element: <NotFoundPage />
  }
]

const router: ReturnType<typeof createBrowserRouter> = createBrowserRouter(appRoutes)

export default router

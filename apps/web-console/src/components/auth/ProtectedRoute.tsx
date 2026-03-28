import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { ensureConsoleSession, readConsoleShellSession, storeProtectedRouteIntent } from '@/lib/console-session'

type GuardState = 'checking' | 'allowed' | 'denied'

export function ProtectedRoute() {
  const location = useLocation()
  const [guardState, setGuardState] = useState<GuardState>('checking')

  useEffect(() => {
    let active = true

    const initialSession = readConsoleShellSession()
    if (!initialSession) {
      storeProtectedRouteIntent(`${location.pathname}${location.search}${location.hash}`)
      setGuardState('denied')
      return () => {
        active = false
      }
    }

    ensureConsoleSession()
      .then((session) => {
        if (!active) {
          return
        }

        if (session) {
          setGuardState('allowed')
          return
        }

        storeProtectedRouteIntent(`${location.pathname}${location.search}${location.hash}`)
        setGuardState('denied')
      })
      .catch(() => {
        if (!active) {
          return
        }

        storeProtectedRouteIntent(`${location.pathname}${location.search}${location.hash}`)
        setGuardState('denied')
      })

    return () => {
      active = false
    }
  }, [location.hash, location.pathname, location.search])

  if (guardState === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 py-16 text-foreground">
        <div className="rounded-3xl border border-border bg-card/80 px-6 py-5 text-sm text-muted-foreground shadow-lg backdrop-blur">
          Verificando la sesión protegida de la consola…
        </div>
      </div>
    )
  }

  if (guardState === 'denied') {
    return <Navigate replace to="/login" />
  }

  return <Outlet />
}

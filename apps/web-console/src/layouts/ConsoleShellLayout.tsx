import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  Activity,
  ChevronDown,
  Database,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Settings,
  Shield,
  User,
  Workflow
} from 'lucide-react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { terminateConsoleLoginSession } from '@/lib/console-auth'
import {
  clearConsoleShellSession,
  getConsolePrincipalInitials,
  getConsolePrincipalLabel,
  getConsolePrincipalSecondary,
  readConsoleShellSession
} from '@/lib/console-session'
import { cn } from '@/lib/utils'

const consoleNavigationItems = [
  {
    label: 'Overview',
    to: '/console/overview',
    icon: LayoutDashboard,
    description: 'Punto de entrada para la consola administrativa y su estado general.'
  },
  {
    label: 'Tenants',
    to: '/console/tenants',
    icon: Shield,
    description: 'Acceso base al dominio multi-tenant y su navegación principal.'
  },
  {
    label: 'Workspaces',
    to: '/console/workspaces',
    icon: FolderKanban,
    description: 'Superficie incremental para la organización por workspaces.'
  },
  {
    label: 'Functions',
    to: '/console/functions',
    icon: Workflow,
    description: 'Entrada persistente al dominio serverless del producto.'
  },
  {
    label: 'Storage',
    to: '/console/storage',
    icon: Database,
    description: 'Navegación base al área de almacenamiento y datos relacionados.'
  },
  {
    label: 'Observability',
    to: '/console/observability',
    icon: Activity,
    description: 'Acceso inicial al dominio de métricas, alertas y auditoría.'
  }
] as const

export function ConsoleShellLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [session, setSession] = useState(() => readConsoleShellSession())
  const [menuOpen, setMenuOpen] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const avatarButtonRef = useRef<HTMLButtonElement | null>(null)

  const principalLabel = useMemo(() => getConsolePrincipalLabel(session), [session])
  const principalSecondary = useMemo(() => getConsolePrincipalSecondary(session), [session])
  const principalInitials = useMemo(() => getConsolePrincipalInitials(session), [session])
  const principalRoles = session?.principal?.platformRoles ?? []

  useEffect(() => {
    setSession(readConsoleShellSession())
  }, [location.pathname])

  useEffect(() => {
    if (!menuOpen) {
      return undefined
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node | null
      if (!target) {
        return
      }

      if (menuRef.current?.contains(target) || avatarButtonRef.current?.contains(target)) {
        return
      }

      setMenuOpen(false)
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return
      }

      setMenuOpen(false)
      avatarButtonRef.current?.focus()
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [menuOpen])

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      return
    }

    event.preventDefault()

    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[data-shell-menu-item="true"]') ?? [])
    if (items.length === 0) {
      return
    }

    const currentIndex = items.findIndex((item) => item === document.activeElement)

    if (event.key === 'Home') {
      items[0]?.focus()
      return
    }

    if (event.key === 'End') {
      items[items.length - 1]?.focus()
      return
    }

    const nextIndex =
      currentIndex === -1
        ? 0
        : event.key === 'ArrowDown'
          ? (currentIndex + 1) % items.length
          : (currentIndex - 1 + items.length) % items.length

    items[nextIndex]?.focus()
  }

  async function handleLogout() {
    setIsLoggingOut(true)

    try {
      if (session?.sessionId && session.tokenSet?.accessToken) {
        await terminateConsoleLoginSession(session.sessionId, session.tokenSet.accessToken)
      }
    } catch {
      // El cierre local sigue ocurriendo aunque la invalidación remota degrade.
    } finally {
      clearConsoleShellSession()
      setSession(null)
      setMenuOpen(false)
      setIsLoggingOut(false)
      navigate('/login', { replace: true })
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="fixed inset-x-0 top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-sm font-semibold text-primary-foreground">
              IA
            </div>
            <div className="min-w-0">
              <Link className="block truncate text-base font-semibold tracking-tight" to="/console/overview">
                In Atelier Console
              </Link>
              <p className="truncate text-xs text-muted-foreground">Shell persistente base · EP-14 / US-UI-01-T04</p>
            </div>
          </div>

          <div className="relative flex items-center gap-3">
            <div className="hidden text-right md:block">
              <p className="text-sm font-medium text-foreground">{principalLabel}</p>
              <p className="text-xs text-muted-foreground">{principalSecondary}</p>
            </div>

            <button
              ref={avatarButtonRef}
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={`Abrir menú de usuario de ${principalLabel}`}
              data-testid="console-shell-avatar"
              onClick={() => setMenuOpen((current) => !current)}
              className="inline-flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2 shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">
                {principalInitials ? principalInitials : <User className="h-4 w-4" aria-hidden="true" />}
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </button>

            {menuOpen ? (
              <div
                ref={menuRef}
                role="menu"
                aria-label="Menú de usuario"
                onKeyDown={handleMenuKeyDown}
                className="absolute right-0 top-[calc(100%+0.75rem)] z-50 w-72 rounded-2xl border border-border bg-popover p-2 shadow-2xl"
              >
                <div className="rounded-xl border border-border/70 bg-background/60 p-3">
                  <p className="text-sm font-semibold text-popover-foreground">{principalLabel}</p>
                  <p className="text-xs text-muted-foreground">{principalSecondary}</p>
                  {principalRoles.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {principalRoles.slice(0, 3).map((role) => (
                        <Badge key={role} variant="outline">
                          {role}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="mt-2 grid gap-1">
                  <Link
                    to="/console/profile"
                    role="menuitem"
                    data-shell-menu-item="true"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <User className="h-4 w-4" aria-hidden="true" />
                    Profile
                  </Link>
                  <Link
                    to="/console/settings"
                    role="menuitem"
                    data-shell-menu-item="true"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Settings className="h-4 w-4" aria-hidden="true" />
                    Settings
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    data-shell-menu-item="true"
                    disabled={isLoggingOut}
                    onClick={handleLogout}
                    className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    {isLoggingOut ? 'Cerrando sesión…' : 'Logout'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1600px] pt-16">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-72 shrink-0 overflow-y-auto border-r border-border bg-card/35 px-4 py-6 lg:block">
          <div className="space-y-2 rounded-3xl border border-border/70 bg-background/50 p-4">
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">Navegación principal</p>
            <nav aria-label="Navegación principal de consola" className="space-y-1">
              {consoleNavigationItems.map((item) => {
                const Icon = item.icon

                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      cn(
                        'flex items-start gap-3 rounded-2xl px-3 py-3 text-sm transition-colors',
                        isActive ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', isActive ? 'text-primary-foreground' : 'text-current')} aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="block font-medium">{item.label}</span>
                          <span className={cn('mt-1 block text-xs leading-5', isActive ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                            {item.description}
                          </span>
                        </span>
                      </>
                    )}
                  </NavLink>
                )
              })}
            </nav>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:h-[calc(100vh-4rem)] lg:overflow-y-auto lg:px-8 lg:py-8">
          <div className="mx-auto max-w-5xl">
            <Outlet />
          </div>
        </main>
      </div>

      <div className="border-t border-border bg-background/95 px-4 py-3 lg:hidden">
        <p className="text-xs text-muted-foreground">La experiencia optimizada para móvil llegará en una iteración posterior. T04 cubre el shell de escritorio.</p>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  createConsoleLoginSession,
  getConsoleAccountStatusView,
  getConsoleSignupPolicy,
  inferStatusViewFromError,
  type ConsoleAccountStatusView,
  type ConsoleSignupPolicy
} from '@/lib/console-auth'
import { consoleAuthConfig } from '@/lib/console-config'
import {
  consumeConsoleAuthStatusHint,
  consumeProtectedRouteIntent,
  ensureConsoleSession,
  persistConsoleShellSession
} from '@/lib/console-session'
import type { ApiError } from '@/lib/http'

type FeedbackState =
  | { variant: 'default' | 'success' | 'destructive'; title: string; message: string }
  | null

const initialForm = {
  username: '',
  password: '',
  rememberMe: false
}

function resolvePostLoginDestination(): string {
  return consumeProtectedRouteIntent() ?? '/console/overview'
}

export function LoginPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState(initialForm)
  const [signupPolicy, setSignupPolicy] = useState<ConsoleSignupPolicy | null>(null)
  const [policyLoading, setPolicyLoading] = useState(true)
  const [feedback, setFeedback] = useState<FeedbackState>(null)
  const [statusView, setStatusView] = useState<ConsoleAccountStatusView | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    getConsoleSignupPolicy(controller.signal)
      .then((policy) => {
        setSignupPolicy(policy)
      })
      .catch(() => {
        setSignupPolicy(null)
      })
      .finally(() => {
        setPolicyLoading(false)
      })

    return () => controller.abort()
  }, [])

  useEffect(() => {
    const hint = consumeConsoleAuthStatusHint()
    if (hint) {
      setFeedback({
        variant: 'default',
        title: hint.title,
        message: hint.message
      })
    }

    let active = true

    ensureConsoleSession()
      .then((session) => {
        if (!active || !session) {
          return
        }

        navigate(resolvePostLoginDestination(), { replace: true })
      })
      .catch(() => undefined)

    return () => {
      active = false
    }
  }, [navigate])

  const signupVisible = Boolean(signupPolicy?.allowed)

  const statusAction = useMemo(() => {
    const firstAllowedAction = statusView?.allowedActions[0] ?? null

    if (firstAllowedAction) {
      return firstAllowedAction
    }

    if (statusView?.statusView === 'pending_activation') {
      return {
        actionId: 'view_pending_activation',
        label: 'Ver estado de activación',
        target: consoleAuthConfig.pendingActivationPath
      }
    }

    return null
  }, [statusView])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFeedback(null)
    setStatusView(null)
    setIsSubmitting(true)

    try {
      const createdSession = await createConsoleLoginSession({
        username: form.username.trim(),
        password: form.password,
        rememberMe: form.rememberMe
      })

      persistConsoleShellSession(createdSession)
      setFeedback({
        variant: 'success',
        title: 'Sesión creada correctamente',
        message: 'Redirigiendo al destino protegido solicitado…'
      })
      navigate(resolvePostLoginDestination(), { replace: true })
    } catch (rawError) {
      const error = rawError as ApiError
      const inferredStatus = inferStatusViewFromError(error)

      if (error.status === 409 && inferredStatus) {
        setFeedback({
          variant: 'default',
          title: inferredStatus.title,
          message: inferredStatus.message
        })

        if (inferredStatus.statusView !== 'login') {
          try {
            const view = await getConsoleAccountStatusView(inferredStatus.statusView)
            setStatusView(view)
          } catch {
            setStatusView({
              statusView: inferredStatus.statusView,
              title: inferredStatus.title,
              message: inferredStatus.message,
              allowedActions: []
            })
          }
        }
      } else if (error.status === 400 || error.status === 403) {
        setFeedback({
          variant: 'destructive',
          title: 'No hemos podido validar tus credenciales',
          message: error.message || 'Revisa tu usuario y contraseña e inténtalo de nuevo.'
        })
      } else {
        setFeedback({
          variant: 'destructive',
          title: 'El servicio de acceso no está disponible ahora mismo',
          message:
            error.message || 'Ha ocurrido un error operativo. Puedes reintentar en unos instantes sin recargar la consola.'
        })
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16 text-foreground">
      <section className="w-full max-w-3xl rounded-3xl border border-border bg-card/80 p-10 shadow-2xl shadow-black/20 backdrop-blur">
        <div className="mb-8 space-y-3">
          <img src="/img/logo-wide.png" alt="In Falcone" className="mb-4 h-16 w-auto" />
          <Badge variant="secondary">EP-14 / US-UI-01-T05</Badge>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{consoleAuthConfig.headings.title}</h1>
          <p className="max-w-2xl text-lg leading-8 text-muted-foreground">{consoleAuthConfig.headings.subtitle}</p>
          <p className="text-sm leading-6 text-muted-foreground">
            Realm <span className="font-medium text-foreground">{consoleAuthConfig.realm}</span> · Client ID{' '}
            <span className="font-medium text-foreground">{consoleAuthConfig.clientId}</span>
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="username">{consoleAuthConfig.labels.username}</Label>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                value={form.username}
                onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
                placeholder="operaciones"
                required
                minLength={3}
                maxLength={120}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{consoleAuthConfig.labels.password}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={form.password}
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                placeholder="••••••••••••"
                required
                minLength={12}
                maxLength={256}
              />
            </div>

            <label className="flex items-start gap-3 rounded-2xl border border-border/70 p-4 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={form.rememberMe}
                onChange={(event) => setForm((current) => ({ ...current, rememberMe: event.target.checked }))}
                className="mt-1 h-4 w-4 rounded border-border"
              />
              <span>{consoleAuthConfig.labels.rememberMe}</span>
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? consoleAuthConfig.labels.submitLoading : consoleAuthConfig.labels.submit}
              </Button>
              <Button asChild type="button" variant="link" className="px-0">
                <Link to={consoleAuthConfig.passwordRecoveryPath}>{consoleAuthConfig.labels.passwordRecovery}</Link>
              </Button>
            </div>

            {feedback ? (
              <Alert variant={feedback.variant}>
                <AlertTitle>{feedback.title}</AlertTitle>
                <AlertDescription>{feedback.message}</AlertDescription>
              </Alert>
            ) : null}

            {statusView ? (
              <Alert>
                <AlertTitle>{statusView.title}</AlertTitle>
                <AlertDescription>
                  <span className="block">{statusView.message}</span>
                  {statusAction ? (
                    <Link className="mt-3 inline-flex font-medium text-primary underline underline-offset-4" to={statusAction.target}>
                      {statusAction.label}
                    </Link>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
          </form>

          <aside className="space-y-4 rounded-3xl border border-border/70 bg-background/40 p-6">
            <h2 className="text-lg font-semibold">Acceso y descubribilidad</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              La consola consulta la policy efectiva de auto-registro y, si la sesión expira, devuelve al usuario al destino protegido una vez vuelva a autenticarse.
            </p>
            {policyLoading ? (
              <p className="text-sm text-muted-foreground">Cargando policy de registro…</p>
            ) : signupVisible ? (
              <Button asChild variant="outline" className="w-full">
                <Link to={consoleAuthConfig.signupPath}>{consoleAuthConfig.labels.signup}</Link>
              </Button>
            ) : (
              <Alert>
                <AlertTitle>Registro no disponible</AlertTitle>
                <AlertDescription>{signupPolicy?.reason ?? consoleAuthConfig.labels.signupDisabled}</AlertDescription>
              </Alert>
            )}
            <div className="rounded-2xl border border-dashed border-border/70 p-4 text-sm leading-6 text-muted-foreground">
              Esta iteración ya protege el shell, conserva el destino solicitado y prepara la base para que T06 valide login, logout y navegación por E2E.
            </div>
          </aside>
        </div>
      </section>
    </main>
  )
}
